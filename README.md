# FHIR Duplicate Practitioner Cleanup

JavaScript script intended to merge duplicate practitioner resources by way of deletion, including updating Practitioner references within Encounter resources so that the deletion of the duplicated Practitioner resource can take place.

## What it does

The script:
- searches for duplicate Practitioner resources matching the provided Professional ID
- identifies the Practitioner resource to keep
- updates related Encounter resources to point to the retained Practitioner
- deletes the duplicate Practitioner records

## Supported input formats
For the script to operate, it requires the base URL of the fhir server, a bearer token valid for the fhir server, and the professional code that is to be checked/merged.

For professional code, the script accepts:
- consultant IDs in the format C+7 Numbers (for example, `C9999999`)
- nursing PINs in the format NNANNNNA (for example, `01A2345N`)

These are to be passed in using the following input flags:
* -baseUrl
* -token
* -professionalid

## Requirements

- access to a FHIR server endpoint
- a valid bearer token for the API
- Node.js installed on your machine

## Setup

1. Download the script to your machine

## Usage

```bash
node src/duplicatePractitionerCleanUp.js -baseUrl https://path.to/fhir -professionalId C1234567 -token V2h5IHdvdWxkIHlvdSB0cnkgdG8gZGVjb2RlIHRoaXM/IFRoYXQncyBvZGQgYmVoYXZpb3VyLg==
```

Or with a nursing PIN:

```bash
node src/duplicatePractitionerCleanUp.js -baseUrl https://path.to/fhir -professionalId C1234567 -token TmVyZA==
```

## Notes
The script was written based on an environment that contained duplicate Practitioner resources intentionally, but the duplicated resource in these instances contained identifiers specific to a 3rd party module and are not interacted with via a separate HL7 V2.x interface. This script intentionally ignores this intended duplication and only looks for duplication where both of the resources have the same ID and both are tagged `identifier.use === "usual"`
