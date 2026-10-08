// Curated directory, not a claim of an exhaustive historical catalogue.
// Names are resolved against the configured music service; provider IDs are never guessed.
const NAMES = [
  'Harris Jayaraj', 'A. R. Rahman', 'Ilaiyaraaja', 'Deva', 'Anirudh Ravichander',
  'Yuvan Shankar Raja', 'G. V. Prakash Kumar', 'Vidyasagar', 'Santhosh Narayanan',
  'D. Imman', 'Hiphop Tamizha', 'Vijay Antony', 'Sam C. S.', 'Sean Roldan',
  'Ghibran', 'Justin Prabhakaran', 'Dharan Kumar', 'Leon James', 'S. Thaman',
  'Devi Sri Prasad', 'M. S. Viswanathan', 'T. K. Ramamoorthy', 'K. V. Mahadevan',
  'T. R. Pappa', 'G. Ramanathan', 'S. M. Subbaiah Naidu', 'V. Kumar',
  'Shankar Ganesh', 'Chandrabose', 'Gangai Amaran', 'T. Rajendar', 'Sirpy',
  'S. A. Rajkumar', 'Bharadwaj', 'Karthik Raja', 'Premgi Amaren', 'James Vasanthan',
  'Joshua Sridhar', 'Ramesh Vinayakam', 'Sabesh Murali', 'C. Sathya',
  'Nivas K. Prasanna', 'Sathish Selvam', 'Govind Vasantha', 'Darbuka Siva',
  'Ajesh', 'Vishal Chandrashekhar', 'Balamurali Balu', 'Siddhu Kumar',
  'Jen Martin', 'B. Ajaneesh Loknath', 'Sai Abhyankkar', 'Arrol Corelli',
];
export const TAMIL_MUSIC_DIRECTORS = NAMES.map((name, index) => ({
  id: `tamil-director:${index}`, name, title: name, type: 'artist',
  role: 'Music Director', subtitle: 'Tamil film music', image: '',
}));
export function resolveTamilDirector(id) {
  return TAMIL_MUSIC_DIRECTORS.find((item) => item.id === id) || null;
}
