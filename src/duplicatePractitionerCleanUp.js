/**
 * FHIR Duplicate Practitioner Cleanup Tool
 *
 * Unofficial script written to:
 * * Check a given professional code for duplicate practitioner entries
 * * Identify encounters associated with the duplicated practitioner
 * * Update the encounters so that they reference the practitioner being kept
 * * Deletes the duplicate encounter
 *
 * @summary Script to delete duplicate Practitioners, with steps to clean up encounters to enable this.
 * @author Julian Matthews <Julian.Matthews@SomersetFT.NHS.UK>
 *
 * Created        : 2026-07-17
 * Last modified   : 2026-07-30
 */

const supportedArgs = ["-baseurl", "-token", "-professionalid"];
var baseUrl, token, professionalID;

// match values from process.argv to the supported args and assign them to the corresponding variables
process.argv.forEach((arg, index) => {
  console.log(`Arg ${index}: ${arg}`);
  //Skip the first two args (node and script path)
  if (index > 1) {
    //Match the arg to the supported args
    const argIndex = supportedArgs.indexOf(arg.toLowerCase());
    if (argIndex !== -1) {
      //If the arg is found, assign the next value in process.argv to the corresponding variable
      const value = process.argv[index + 1];
      switch (arg.toLowerCase()) {
        case "-baseurl":
          baseUrl = value;
          break;
        case "-token":
          token = value;
          break;
        case "-professionalid":
          professionalID = value;
          break;
      }
    }
  }
});

// Check that baseUrl and token are provided
if (!baseUrl || !token || !professionalID) {
  console.error(
    "Error: Please provide both a base URL, a token, and a professional ID as arguments.",
  );
  process.exit(1);
}

// Default params

// check that professionalID is a valid consultant ID (C + 7 numbers) or a valid nmc nursing pin (two digits, a letter, 4 digits, and a letter)
const consultantIdRegex = /^C\d{7}$/;
const NursePinRegex = /^\d{2}[A-Z]\d{4}[A-Z]$/;

if (
  !consultantIdRegex.test(professionalID) &&
  !NursePinRegex.test(professionalID)
) {
  console.error(
    "Error: Please provide a valid consultant ID in the format 'C'+NNNNNNN or nursing PIN in the format NNANNNNA. For example, 'C9999999' or '01A2345N'.",
  );
  process.exit(1);
}

// run the main script
mergePractitioners();

async function mergePractitioners() {
  const headers = buildHeaders();

  // get list of practitioners using the professional code
  try {
    const practitionerBundle = await fetchPractitionerBundle(
      headers,
      professionalID,
    );

    if (!practitionerBundle.entry || practitionerBundle.entry.length === 0) {
      console.error(`No practitioners found for ID ${professionalID}.`);
      return;
    }
    // quit if nothing to merge
    if (practitionerBundle.entry.length === 1) {
      console.error(
        `Only 1 practitioner found for ID ${professionalID}, so there is nothing to merge.`,
      );
      return;
    }

    console.log(
      "Checking if there are enough eligible Practitioner resources returned in the search...",
    );
    const practArray = getUsualPractitionerIds(practitionerBundle);

    // quit if we are left with 1 or 0 eligble practitioners to merge
    if (practArray.length < 2) {
      console.error(
        `Not enough practitioners with identifier use of "usual" found for ID ${professionalID}.`,
      );
      return;
    }

    // keep the first ID and merge the rest - the first ID in the array will always be the smallest number as
    // the getUsualPractitionerIds() function sorts before returning a value, so technically oldest.
    const practIdToKeep = practArray[0];
    console.log(`Keeping ${practIdToKeep}!`);

    // skipping the first entry in the array as we're keeping that resource, loop through the rest
    for (const practIdToMerge of practArray.slice(1)) {
      console.log(`Merging away ${practIdToMerge}...`);

      const encounterSearchBundle = await fetchEncounterBundle(
        headers,
        practIdToMerge,
      );

      if (!encounterSearchBundle.type) {
        throw new Error(
          `Non-FHIR response when checking for encounters for ${practIdToMerge}`,
        );
      }

      if (
        encounterSearchBundle.entry &&
        encounterSearchBundle.entry.length > 0
      ) {
        for (const encounterItem of encounterSearchBundle.entry) {
          await updateEncounterReferences(
            headers,
            encounterItem,
            practIdToMerge,
            practIdToKeep,
          );
        }
      } else {
        console.log(
          `No encounters found for ${practIdToMerge} - moving straight to Practitioner deletion.`,
        );
      }

      await deletePractitioner(headers, practIdToMerge);
    }
  } catch (error) {
    console.error(error.message);
  }
}

function buildHeaders() {
  const headers = {
    Accept: "application/fhir+json",
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  return headers;
}

async function fetchPractitionerBundle(headers, professionalId) {
  const practitionerSearchUrl = `${baseUrl.replace(/\/+$/, "")}/Practitioner?identifier=${encodeURIComponent(professionalId)}`;
  console.log(`Calling ${practitionerSearchUrl} with type "GET"`);

  const practitionerSearchResponse = await fetch(practitionerSearchUrl, {
    headers,
  });

  if (!practitionerSearchResponse.ok) {
    throw new Error(
      `Error fetching practitioner resources - ${practitionerSearchResponse.status} ${practitionerSearchResponse.statusText}`,
    );
  }
  return practitionerSearchResponse.json();
}

function getUsualPractitionerIds(practitionerBundle) {
  return (practitionerBundle.entry ?? [])
    .filter((entry) => entry.resource?.id)
    .filter((entry) => {
      const identifiers = entry.resource?.identifier ?? [];
      return identifiers.some((identifier) => identifier.use === "usual");
    })
    .map((entry) => entry.resource.id)
    .sort((a, b) => a - b);
}

async function fetchEncounterBundle(headers, practitionerIdToMerge) {
  const encounterSearchUrl = `${baseUrl.replace(/\/+$/, "")}/Encounter?practitioner=${practitionerIdToMerge}`;
  console.log(`Calling ${encounterSearchUrl} with type "GET"`);

  const encounterSearchResponse = await fetch(encounterSearchUrl, {
    headers,
  });

  if (!encounterSearchResponse.ok) {
    throw new Error(
      `Error fetching encounters for practitioner ${practitionerIdToMerge} - ${encounterSearchResponse.status} ${encounterSearchResponse.statusText}`,
    );
  }

  return encounterSearchResponse.json();
}

async function updateEncounterReferences(
  headers,
  encounterItem,
  practitionerIdToMerge,
  practitionerIdToKeep,
) {
  const encounterId = encounterItem.resource?.id;
  if (!encounterId) {
    return;
  }

  const participants = Array.isArray(encounterItem.resource?.participant)
    ? encounterItem.resource.participant
    : [];

  const updatedEncounter = {
    ...encounterItem.resource,
    participant: participants.map((participant) => {
      if (
        participant.individual?.reference ===
        `Practitioner/${practitionerIdToMerge}`
      ) {
        return {
          ...participant,
          individual: {
            reference: `Practitioner/${practitionerIdToKeep}`,
          },
        };
      }
      return participant;
    }),
  };

  const updateEncounterUrl = `${baseUrl.replace(/\/+$/, "")}/Encounter/${encounterId}`;
  const updateResponse = await fetch(updateEncounterUrl, {
    method: "PUT",
    headers: {
      ...headers,
      "Content-Type": "application/fhir+json",
    },
    body: JSON.stringify(updatedEncounter),
  });

  console.log(
    `Updated encounter ${encounterId} to point from practitioner ${practitionerIdToMerge} to practitioner ${practitionerIdToKeep}: ${updateResponse.status} ${updateResponse.statusText}`,
  );
}

async function deletePractitioner(headers, practitionerIdToMerge) {
  const deletePractitionerUrl = `${baseUrl.replace(/\/+$/, "")}/Practitioner/${practitionerIdToMerge}`;
  const deleteResponse = await fetch(deletePractitionerUrl, {
    method: "DELETE",
    headers: {
      ...headers,
    },
  });

  console.log(
    `Deleted practitioner ${practitionerIdToMerge}: ${deleteResponse.status} ${deleteResponse.statusText}`,
  );
}
