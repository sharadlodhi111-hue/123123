# MURLIDHAR CLASSES

### CBSE Class 10 Science Study Planner | 2026–2027

A mobile-friendly React and Vite study planner designed for CBSE Class 10 Science Board Examination 2027.

## Features
- Google authentication using Supabase.
- Daily and weekly study planner.
- Physics, Chemistry and Biology chapter tracking.
- Progress dashboard.
- Science Resource Library.
- PDF.js integrated document viewer.
- Mobile-responsive interface.

## Technology
- React
- Vite
- Supabase
- PDF.js
- Tailwind CSS

## Run Locally

1. Install Node.js and pnpm.
2. Run `pnpm install`.
3. Configure `.env.local` with:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_PUBLISHABLE_KEY`
4. Run `pnpm run dev`.

## Build

Run:

`pnpm run build`

The production files are generated in the `dist` folder.

## Security

Never publish `.env.local`, Supabase service-role keys, secret keys, or private credentials.