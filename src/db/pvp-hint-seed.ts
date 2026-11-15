/**
 * The Prydwen PVP tier list (1v1 and 3v3) as it stood on 2026-11-13, the first values of the Tier hints (ADR 0036). Each hero is
 * listed under its tier and the role column Prydwen put it in. It is read once by a migration; after that the player keeps the hints
 * in Admin > Units, and a hero Prydwen did not rate (Chippy, Gala, Hammie, Thane) has none.
 */
export const PRYDWEN_PVP_DATE = '2026-11-13';

type Role = 'Damage dealer' | 'Specialist' | 'Support' | 'Tank';

export const PRYDWEN_PVP: Record<string, Record<Role, string[]>> = {
  'S+': {
    'Damage dealer': ['Aster', 'Gwyneth', 'Marene', 'Orion', 'Senea', 'Sylphira'],
    Specialist: ['Kulu', 'Mehira'],
    Support: ['Contess', 'Rolan'],
    Tank: ['Alna', 'Dunlingr', 'Gunnar'],
  },
  S: {
    'Damage dealer': ['Athalia', 'Eryndor', 'Taichi & Agumon'],
    Specialist: ['Aliceth', 'Frieren', 'Saida'],
    Support: ['Elijah and Lailah', 'Evie', 'Solise'],
    Tank: ['Hepler', 'Thador'],
  },
  'A+': {
    'Damage dealer': ['Baden', 'Cryonaia', 'Marcille', 'Perseus'],
    Specialist: ['Baelran', 'Cyran', 'Estrilda', 'Lily May', 'Ravion', 'Shadewing', 'Zandrok', 'Zorya'],
    Support: ['Himmel', 'Pandora', 'Rowan'],
    Tank: ['Callan', 'Gerda'],
  },
  A: {
    'Damage dealer': ['Dionel', 'Pang', 'Shemira', 'Silven'],
    Specialist: ['Bonnie', 'Eironn', 'Igor', 'Kazim', 'Kordan', 'Nerion', 'Satrana', 'Shakir', 'Tasi', 'Ulmus', 'Yamato & Gabumon'],
    Support: ['Hugin', 'Koko', 'Ludovic', 'Niru', 'Peggy'],
    Tank: ['Daimon', 'Phraesto', 'Tilaya'],
  },
  B: {
    'Damage dealer': ['Alsa', 'Berial', 'Faramor', 'Galahad', 'Harak', 'Indris', 'Lenya', 'Natsu Dragneel', 'Nazrik', 'Odie', 'Silvina', 'Vala', 'Voracia'],
    Specialist: ['Lamentis', 'Lyca', 'Nara', 'Parisa', 'Scarlita', 'Soren', 'Talene', 'Valka', 'Zanie'],
    Support: ['Aurora', 'Damian', 'Mikola', 'Reinier', 'Sonja', 'Velara'],
    Tank: ['Antandra', 'Brutus', 'Karma', 'Lucca', 'Lucius', 'Thoran'],
  },
  C: {
    'Damage dealer': ['Arden', 'Atalanta', 'Bryon', 'Cecia', 'Florabelle', 'Marilee', 'Mirael', 'Pippa', 'Rhys', 'Salazer', 'Seth', 'Valen', 'Viperian'],
    Specialist: ['Carolina', 'Cassadee', 'Hodgkin', 'Kafra', 'Korin', 'Kruger', 'Lorsan', 'Lucy Heartfilia', 'Sinbad', 'Temesia', 'Walker'],
    Support: ['Fay', 'Hewynn', 'Isabella', 'Smokey & Meerky'],
    Tank: ['Granny Dahnie', 'Laios', 'Lumont'],
  },
};

/** Prydwen's spelling of the heroes the database spells differently. */
export const PRYDWEN_NAMES: Record<string, string> = {
  'Taichi & Agumon': 'Taichi&Agumon',
  'Elijah and Lailah': 'Elijah & Lailah',
  'Yamato & Gabumon': 'YamatoGabumon',
  'Natsu Dragneel': 'Natsu',
  'Lucy Heartfilia': 'Lucy',
};
