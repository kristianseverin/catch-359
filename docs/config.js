// Catch 359 — site settings. Edit this file, commit, and the site updates.
//
// supabaseUrl / supabaseAnonKey: from Supabase → Project settings → API.
// The anon key is meant to be public; the database rules in supabase/schema.sql
// make sure it can only sign riders up and read the public start list.
// Leave them empty to preview the site in demo mode (nothing is saved).

export const config = {
  supabaseUrl: '',
  supabaseAnonKey: '',

  eventName: 'Catch 359',
  eventDate: '',          // e.g. '2027-06-12' — leave empty to show "Date to be announced"
  startTime: '',          // e.g. '06:00'
  startArea: '',          // e.g. 'Riders start where they are placed on the route'
  contactEmail: '',       // shown in the footer, e.g. 'hello@catch359.dk'

  routeName: "Denmark's biggest circle",
  routeUrl: 'https://www.komoot.com/tour/3331824715',
  routeKm: 578,
};
