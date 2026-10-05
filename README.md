# Catch 359

Sign-up website for **Catch 359**: 360 ultra cyclists start one degree apart on Denmark's biggest circle (578 km). Everyone starts at once; if the rider behind you catches you, you're out. Last rider standing wins.

- **Public page** (`docs/index.html`): event info and rules, the real route drawn with its 360 start spots on a map of Jutland, an elevation profile, an interactive map (street and satellite view) where every start spot can be clicked, GPX downloads of the route and of all 360 start spots, the sign-up form, and — once you publish the draw — the start list with every rider's degree and km.
- **Organizer page** (`docs/admin.html`): log in, see every rider with contact and emergency details, withdraw riders, move riders up from the waitlist, run the random start-spot draw, publish it, and download everything as CSV.
- **Database** (`supabase/schema.sql`): Supabase (Postgres) tables, security rules and functions.

No build step: the site is plain HTML, CSS and JavaScript, hosted free on GitHub Pages.

## How sign-ups work

1. The first 360 riders go on the start list. After that, new riders join the waitlist.
2. When you run the draw, registration closes and every rider on the start list gets a random start spot from 0 to 359. Spots are fixed points on the route, 578 km / 360 ≈ 1.6 km apart along the road; spot 0 is in Aarhus and the numbers count up in the direction of travel. With fewer than 360 riders, some spots stay empty.
3. You check the result, then publish it. Only then does the start list appear on the public page.
4. If someone withdraws after the draw, their spot becomes empty. "Add to start list" on a waitlisted rider gives them a random free spot (for example the one that just opened up).

Privacy: the public can only see counts and, after you publish, each rider's name, country, club and degree. Emails, phone numbers, emergency contacts and experience are visible only to organizers. The browser never gets read access to the registrations table; it can only call the sign-up function.

## Setup (about 15 minutes)

### 1. Create the database

1. Create a free account at [supabase.com](https://supabase.com) and make a new project. Pick an EU region (for example Frankfurt or Stockholm), since you're collecting personal data about riders.
2. In the project, open **SQL Editor**, paste the whole of `supabase/schema.sql`, and run it.

### 2. Add an organizer

1. Open **Authentication → Users → Add user**, enter your email and a password, and tick the option to auto-confirm the user.
2. In **SQL Editor**, run (with your email):

   ```sql
   insert into public.admins (user_id)
   select id from auth.users where email = 'you@example.com';
   ```

   Repeat for each organizer.
3. In the Authentication settings, turn off **Allow new users to sign up**. Riders don't need accounts, and this stops strangers creating logins. (They couldn't see any data anyway, since only users in `admins` can.)

### 3. Connect the site

1. In Supabase, open **Project settings → API** (or **API Keys**) and copy the **Project URL** and the **anon / publishable** key. This key is meant to be public.
2. Put them in `docs/config.js`, together with the event date, start time and contact email:

   ```js
   supabaseUrl: 'https://abcdefgh.supabase.co',
   supabaseAnonKey: 'eyJ…',
   eventDate: '2027-06-12',
   contactEmail: 'hello@example.com',
   ```

### 4. Publish on GitHub Pages

In the GitHub repository go to **Settings → Pages**, choose **Deploy from a branch**, branch `main`, folder `/docs`, and save. The site appears at `https://<your-username>.github.io/catch-359/` after a minute or two, and the organizer page at `…/catch-359/admin.html`. You can point your own domain at it from the same settings page.

## The route

`route/source.gpx` is the route exported from [Komoot](https://www.komoot.com/tour/3331824715). From it, `tools/build_route.py` makes:

- `docs/route-data.js` — the map of Jutland, towns, the route outline, the 360 spot positions and the elevation profile
- `docs/route-track.json` — the route line and spots for the interactive map
- `docs/downloads/catch-359-route.gpx` — the route for riders' GPS devices
- `docs/downloads/catch-359-start-spots.gpx` — all 360 start spots as waypoints

The coastline in `route/land.json` comes from [Natural Earth](https://www.naturalearthdata.com) (public domain), made with `python3 tools/fetch_basemap.py`; only re-run it if you change `MAP_EXTENT` in `tools/build_route.py`. Town names and positions are listed in `TOWNS` in the same file (from [GeoNames](https://www.geonames.org), CC BY 4.0); edit that list to add or remove towns, and use `side` to move a label.

The interactive map uses [Leaflet](https://leafletjs.com) with street tiles from [OpenStreetMap](https://www.openstreetmap.org) and satellite imagery from Esri. Neither needs an API key, and the credits are shown in the corner of the map. OpenStreetMap's tile servers are run by volunteers and are fine for a small event site ([usage policy](https://operations.osmfoundation.org/policies/tiles/)); if the site gets heavy traffic, switch to a commercial tile provider in `docs/map.js`.

If the route changes, replace `route/source.gpx` and run `python3 tools/build_route.py` (no extra packages needed), then commit the results. The GPX measures 580.8 km; spots are placed at equal fractions of that length, and km labels on the site use the official 578 km.

## Preview without a database

```sh
cd docs
python3 -m http.server 8000
```

Then open:

- `http://localhost:8000/` — the page as it will look on launch day
- `http://localhost:8000/?demo` — with 137 sample sign-ups
- `http://localhost:8000/?demo=startlist` — with a published sample start list
- `http://localhost:8000/admin.html?demo` — the organizer page with sample riders (changes are not saved)

Nothing is saved until `config.js` has your Supabase details.

## Running the event, step by step

1. Share the site. Watch sign-ups on the organizer page.
2. When you're ready, press **Run the draw** (this also closes registration). You can run it again to reshuffle until you publish.
3. Press **Publish start list**.
4. Handle withdrawals: **Withdraw** frees the spot; **Add to start list** on a waitlisted rider fills a free spot.
5. Download the CSV for start-line check-in and the emergency contact list.

## Good to know

- Supabase's free tier may pause a project after a period with no activity. Check the project is active before you open registration, and consider a paid plan for the weeks around the event.
- The site doesn't send emails. Use the CSV (or the email links in the organizer table) to contact riders.
- Delete or anonymise rider data after the event when you no longer need it.

## Files

```
docs/
  index.html   public page
  app.js       sign-up form, live counts, start list
  ring.js      draws the map of Jutland with the route and its 360 start spots
  map.js       the interactive map
  route-track.json  route line and spots for the interactive map
  route-data.js  generated route outline, spots and elevation
  downloads/   GPX files for riders
  admin.html   organizer page
  admin.js     organizer actions and CSV export
  config.js    event settings and Supabase keys
  db.js        Supabase connection
  styles.css, admin.css
supabase/
  schema.sql   tables, security rules and functions
route/
  source.gpx   the route from Komoot
  land.json    coastline for the map (Natural Earth)
tools/
  build_route.py  turns source.gpx into the files above
  fetch_basemap.py  downloads and clips the coastline
```
