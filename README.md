# FHIR Duplicate Practitioner Cleanup

JavaScript script intended to merge duplicate practitioner resources by way of deletion, including updating Practitioner references within Encounter and PractitionerRole resources so that the deletion of the duplicated Practitioner resource can take place.

## What it does

The script:
- searches for duplicate Practitioner resources matching the provided Professional ID
- identifies the Practitioner resource to keep based on the resource id size.
- updates related Encounter resources to point to the retained Practitioner
- updates related PractitionerRole resources to point to the retained Practitioner
- deletes the duplicate Practitioner record(s)

## Required input values

For the script to operate, it requires the base URL of the fhir server, a bearer token valid for the fhir server, and the professional code that is to be checked/merged.

These are to be passed in using the following input flags:
* -baseUrl
* -token
* -professionalid

For professional code, the script accepts:
- consultant IDs in the format C+7 Numbers (for example, `C9999999`)
- nursing PINs in the format NNANNNNA (for example, `01A2345N`)

# Put the safety on!
If you pass in the flag `-safety` then the script will not make any changes but will instead tell you the number of encounter and PractitionerRole resources that could have been updated and which Practitioner resource would have been deleted.

## Requirements

- access to a FHIR server endpoint
- a valid bearer token for the API
- Node.js installed on your machine

## Setup

1. Download the script to your machine

## Usage

```bash
node src/duplicatePractitionerCleanUp.js -baseUrl https://path.to/fhir -professionalId C1234567 -token V2hhdCBhcmUgeW91IGxvb2tpbmcgYXQ/
```

Or with a nursing PIN:

```bash
node src/duplicatePractitionerCleanUp.js -baseUrl https://path.to/fhir -professionalId 26A1234Z -token TmVyZA==
```

And with the safety on:
```bash
node src/duplicatePractitionerCleanUp.js -baseUrl https://path.to/fhir -professionalId C7654321 -token QXJlIHlvdSBhIGNvcD8
```

## Notes

The script was written based on an a fhir server that contained duplicate Practitioner resources intentionally for a specific module to operate, as well as duplication created due to indexing issues affecting the processing of HL7 V2.x message that resulted in duplicate resource. This script intentionally ignores this intended duplication and only looks for duplication where both of the resources have the same ID and both are tagged `identifier.use === "usual"` as this is the tagging used by the HL7 V2.x interface. This script is not needed for fhir servers with the ability to merge practitioners, and may require some tweaks and testing an a non-production environment before being let loose in a production setting.
