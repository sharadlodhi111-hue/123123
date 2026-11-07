# Murlidhar Classes · CBSE Class 10 Science Planner

A mobile-first React and Vite planner for CBSE Class 10 Science (2026–27). It keeps the existing dashboard and study-plan flow, adds Google sign-in, and organizes the supplied Science PDFs into the four resource-library sections.

## Run locally

1. Install Node.js 20 or later and pnpm.
2. Run `pnpm install`.
3. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in `.env.local`.
4. Apply migrations in order: `0001_student_planner_data.sql`, `0002_resource_library.sql`, then `0003_resource_ranges_and_categories.sql`.
5. Run `pnpm run dev`.

## Google sign-in setup

The app uses Supabase Auth OAuth with Google. Students do not enter a Gmail password in this app. Google uses the account already signed in on the device when available; otherwise Google shows its account chooser/sign-in screen.

1. In Google Cloud Console, create a Web OAuth client. Add Supabase's callback URL, `https://<project-ref>.supabase.co/auth/v1/callback`, to its authorized redirect URIs.
2. In Supabase Auth → Sign-in methods → Google, enable the provider and enter the Google client ID and secret.
3. In Supabase Auth URL configuration, set the app's Site URL and allow its origin (for example `http://localhost:5173/**` for development and the deployed site origin for production).
4. Return to the app and choose **Continue with Google** or **Sign up with Google**. Google sends the browser back to the app origin, including on a mobile browser/PWA.

OAuth creates a Supabase Auth user the first time and reuses that user's UUID for planner storage. Existing phone-only accounts have different user IDs unless an administrator links/migrates those identities; existing database rows are left intact by these changes.

Without Supabase settings, **Local preview** is a browser-only demo and is not an authenticated account. Do not enter real student records in preview mode.

## Science Resource Library

The student library has **Chapters**, **Short Notes**, **Important Questions (PYQ)**, and **NCERT Exemplar** folders organized by subject and chapter. Original PDFs stay in the private `study-resources` bucket. The viewer uses short-lived signed access and PDF.js page-range loading; student screens have no document download/export/save controls. Browser-level downloading or screenshots cannot be fully prevented.

Apply the resource migrations before importing. Set these variables in a local PowerShell session, then run `pnpm run resources:import`:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` (server-side import only; never use a `VITE_` prefix)
- `SUPABASE_ADMIN_USER_ID` (UUID of the administrator who owns the upload)
- `RESOURCE_SOURCE_DIR` (folder containing the supplied PDFs, such as the user's Downloads folder)

The importer reads `supabase/seed_resource_manifest.json`, uploads the original files to private Storage, records the reviewed chapter page ranges, and skips exact SHA-256 duplicates. It intentionally excludes the glitchy S. Chand Biology PDF and the invalid first Prashant Kirad upload. It uses the replacement Pradeep Biology file for **Life Processes only**. The old printed S. Chand Physics/Chemistry tails and the Exemplar's supplementary chapters/sample papers have clearly labeled resource-only folders; they are not added to the study-planner syllabus.

The supplied Short Notes PDF contains a notice that reproduction/distribution requires written permission. Confirm the right to share that PDF with students before publishing it to the library.

To grant staff resource controls, set `app_metadata.role` to `admin` using a trusted Supabase server-side admin flow. Never set admin privileges from client-side code. Students can only read published records and private PDF objects; admin upload, rename, replace, and delete actions are enforced by RLS and Storage policies.

## Planner behavior

Chapter statuses guide target generation: Not Started chapters get concept learning and NCERT reading, Partially Completed chapters get focused catch-up and practice, and Completed chapters get spaced revision, NCERT questions, and PYQs. Sessions use 50-minute focus blocks with breaks, respect weekly holidays, and stop before the configured exam date. Completing a target updates its chapter and replans future unfinished work while preserving completed tasks and prior dates.

The chapter seed is in `src/syllabus.js`. Planner records are stored per Supabase Auth UUID with row-level security. The local preview stores data only in the current browser.
