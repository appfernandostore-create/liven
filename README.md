# Live

A Node.js application with MongoDB.

## Installation

1. Clone the repository.
2. Run `npm install` to install dependencies.
3. Create a `.env` file with your MongoDB URI.
4. Run `npm start` to start the server.

## Deployment

Deployed on Render: https://liven-7uvp.onrender.com

## Profile Editing Rules

- The business profile card of a completed profile is editable when the verification status is `APPROVED` or `REJECTED`.
- Legal information remains editable only when the profile is `REJECTED`.
- Profiles in `PROCESSING` or `MANUAL_REVIEW` keep all correction flows in read-only mode.
- Profile deletion remains available for persisted profiles.
- Document upload and reupload corrections are accepted only during initial setup or while a completed profile is `REJECTED`.