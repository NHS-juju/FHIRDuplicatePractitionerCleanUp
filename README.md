# FHIR Duplicate Practitioner Cleanup

JavaScript script intended to check for duplication of a FHIR Practitioner resource based on the professional code, and then update all encounters associated with the practitioners being merged away.

## What it does

The script:
- accepts a professional ID as an argument
- searches for duplicate Practitioner resources matching that ID
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
The script was written based on an environment that contained duplicate Practitioner resources intentionally, but these resources contained identifiers specific to a 3rd party module, which includes the professional codes, but are tagged differently to the Practitioner resources added and indended for use by the system when parsing HL7v2.x messages. The duplicates this script intended to correct were those created during issues with the HL7v2.x interface, which is why the script explicitly only targets where the `identifier.use === "usual"`