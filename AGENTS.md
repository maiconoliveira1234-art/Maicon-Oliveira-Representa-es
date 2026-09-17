# Project Instructions

- Before every commit, increment the application patch version.
- Keep the version synchronized in `package.json`, `package-lock.json`, and `src/constants.ts` (`APP_VERSION`).
- Include the version update in the same commit as the corresponding code changes.

## User authorization preference

- The user explicitly grants standing authorization for this CRM: a request to commit includes pushing the completed change to the existing GitHub main branch and allowing the existing Vercel production deployment. Do not request a second confirmation for these steps.
- This authorization applies to the requested CRM work. Base changes on the current remote revision and complete appropriate validation before publishing.
