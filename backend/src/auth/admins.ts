// The admins. There is no sign-up: these accounts exist only because `npm run seed:admins`
// creates them. To add or remove an admin, change this list and run the seed again.
export const ADMINS = [
  { name: 'Josue Mapagdalita', email: 'josue.mapagdalita@bytebuntech.com' },
  { name: 'Arvi Genio', email: 'arvi.genio@bytebuntech.com' },
] as const;

/** "Arvi Genio" for an admin's address, else undefined. */
export const adminName = (email: string): string | undefined => ADMINS.find((a) => a.email === email.trim().toLowerCase())?.name;
