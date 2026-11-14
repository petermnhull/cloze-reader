// Function words that are almost always accidental lookups (a mis-tap on "Et" or "la").
export const STOPWORDS = {
  fr: new Set(
    `le la les l un une des du de d au aux à et ou mais donc or ni car que qu qui quoi dont où
     ce c cet cette ces se s ne n pas il elle ils elles on je j tu nous vous me m te t lui leur
     leurs son sa ses mon ma mes ton ta tes notre nos votre vos en y par pour avec sans sur dans
     être avoir`.split(/\s+/),
  ),
};
