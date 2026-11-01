# Spill the Tank

Anonymous propane price & discussion board.

**Operated by Fair America LLC.**

## Features (demo / staging)

- Stay Anonymous toggle (default ON) with random handles
- Price board: post supplier, county, town/ZIP, $/gal, type, tank status
- Discussion threads
- Company averages auto-calculated
- Mobile-first, installable PWA
- Data stored locally in browser (empty start — be the first)
- No IP, no GPS, town/ZIP only

## Production notes

For real multi-user backend: Next.js + Supabase (anon key, RLS, no IP logging, EXIF strip + OCR blur on upload).

Admin CSV export available in full version.

## Launch

Deploy this folder to any static host. For full features, connect Supabase.
