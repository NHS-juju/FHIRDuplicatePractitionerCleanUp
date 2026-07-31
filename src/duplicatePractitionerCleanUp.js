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
 **/

// declare the args in play for this script
const supportedArgs = ["-baseurl", "-token", "-professionalid", "-safety"];

// match values from process.argv to the supported args and assign them to the corresponding variables
var baseUrl, token, professionalID, safety;
process.argv.forEach((arg, index) => {
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
        case "-safety":
          safety = 1;
          break;
      }
    }
  }
});

// Check that mandatory vars have been provided to the script
if (!baseUrl || !token || !professionalID) {
  console.error(
    "Error: Please provide a base URL, a token, and a professional ID as arguments.",
  );
  process.exit(1);
}

// Notify if safety flag is set
if (safety) {
  console.log("Safety Flag Set!");
  console.log("Script will not alter or remove any Resources!");
}

// Validate that professionalID is a valid consultant ID (C + 7 numbers) or a valid nmc nursing pin (two digits, a letter, 4 digits, and a letter)
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
    // quit if we find no practitioners
    if (!practitionerBundle.entry || practitionerBundle.entry.length === 0) {
      console.error(`No practitioners found for ID ${professionalID}.`);
      return;
    }
    // quit if we find only 1 practitioner
    if (practitionerBundle.entry.length === 1) {
      console.error(
        `Only 1 practitioner found for ID ${professionalID}, so there is nothing to merge.`,
      );
      return;
    }

    console.log(
      "Checking if there are enough eligible Practitioner resources returned in the search...",
    );

    // returns array of practitioner ids that have identifier.use === "usual", sorted by size
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

      // returns fhir search bundle of encounters where the practitioner is a participant
      const encounterSearchBundle = await fetchEncounterBundle(
        headers,
        practIdToMerge,
      );

      // if type not in resounse, it's likely a non-FHIR response, or an error
      if (
        !encounterSearchBundle.type ||
        (encounterSearchBundle.type &&
          encounterSearchBundle.type != "searchset")
      ) {
        throw new Error(
          `A Search checking for encounters for ${practIdToMerge} failed to return a searchset`,
        );
      }

      // returns fhir search bundle of PractitionerRole where the practitioner is a participant
      const practitionerRoleSearchBundle = await fetchPractitionerRoleBundle(
        headers,
        practIdToMerge,
      );
      if (
        !practitionerRoleSearchBundle.type ||
        (practitionerRoleSearchBundle.type &&
          practitionerRoleSearchBundle.type != "searchset")
      ) {
        throw new Error(
          `A Search checking for PractitionerRoles for ${practIdToMerge} failed to return a searchset`,
        );
      }

      if (!safety) {
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
            `No encounters found for ${practIdToMerge} - checking PractitionerRoles...`,
          );
        }
        if (
          practitionerRoleSearchBundle.entry &&
          practitionerRoleSearchBundle.entry.length > 0
        ) {
          for (const practitionerRoleItem of practitionerRoleSearchBundle.entry) {
            await updatePractitionerRoleReferences(
              headers,
              practitionerRoleItem,
              practIdToMerge,
              practIdToKeep,
            );
          }
        } else {
          console.log(
            `No practitionerRoles found for ${practIdToMerge} - moving on to Practitioner deletion.`,
          );
        }
        await deletePractitioner(headers, practIdToMerge);
      } else {
        if (encounterSearchBundle.entry) {
          var encCount = encounterSearchBundle.entry.length;
        } else {
          var encCount = 0;
        }
        if (practitionerRoleSearchBundle.entry) {
          var pracRoleCount = practitionerRoleSearchBundle.entry.length;
        } else {
          var pracRoleCount = 0;
        }
        console.log(
          `Running this script would have updated ${encCount} encounter(s) and ${pracRoleCount} PractitionerRole(s) before deleting Practitioner resource ${practIdToMerge}`,
        );
      }
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
async function fetchPractitionerRoleBundle(headers, practitionerIdToMerge) {
  const practitionerRoleSearchUrl = `${baseUrl.replace(/\/+$/, "")}/PractitionerRole?practitioner=${practitionerIdToMerge}`;
  console.log(`Calling ${practitionerRoleSearchUrl} with type "GET"`);

  const practitionerRoleSearchResponse = await fetch(
    practitionerRoleSearchUrl,
    {
      headers,
    },
  );

  if (!practitionerRoleSearchResponse.ok) {
    throw new Error(
      `Error fetching PractitionerRole for practitioner ${practitionerIdToMerge} - ${practitionerRoleSearchResponse.status} ${practitionerRoleSearchResponse.statusText}`,
    );
  }

  return practitionerRoleSearchResponse.json();
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
async function updatePractitionerRoleReferences(
  headers,
  practitioneRoleItem,
  practitionerIdToMerge,
  practitionerIdToKeep,
) {
  const practitioneRoleId = practitioneRoleItem.resource?.id;
  if (!practitioneRoleId) {
    return;
  }

  const practitioner = Array.isArray(practitioneRoleItem.resource?.practitioner)
    ? encounterItem.resource.practitioner
    : [];

  const updatedPractitionerRole = {
    ...practitioneRoleItem.resource,
    practitioner: practitioner.map((practitioner) => {
      if (practitioner.reference === `Practitioner/${practitionerIdToMerge}`) {
        return {
          ...practitioner,
          reference: `Practitioner/${practitionerIdToKeep}`,
        };
      }
      return practitioner;
    }),
  };

  const updatePractitionerRoleUrl = `${baseUrl.replace(/\/+$/, "")}/PractitionerRole/${practitioneRoleId}`;
  const updateResponse = await fetch(updatePractitionerRoleUrl, {
    method: "PUT",
    headers: {
      ...headers,
      "Content-Type": "application/fhir+json",
    },
    body: JSON.stringify(updatedPractitionerRole),
  });

  console.log(
    `Updated PractitionerRole ${practitioneRoleId} to point from practitioner ${practitionerIdToMerge} to practitioner ${practitionerIdToKeep}: ${updateResponse.status} ${updateResponse.statusText}`,
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
