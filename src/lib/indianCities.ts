/**
 * Curated list of prominent Indian cities and towns across states & union territories.
 * Optimized for smart automation and luxury real estate hubs.
 */

export interface IndianCity {
  city: string;
  state: string;
}

export const INDIAN_CITIES: IndianCity[] = [
  // Tier 1 & Metropolitan Hubs
  { city: "Ahmedabad", state: "Gujarat" },
  { city: "Mumbai", state: "Maharashtra" },
  { city: "Bengaluru", state: "Karnataka" },
  { city: "Delhi", state: "Delhi NCR" },
  { city: "New Delhi", state: "Delhi NCR" },
  { city: "Hyderabad", state: "Telangana" },
  { city: "Pune", state: "Maharashtra" },
  { city: "Chennai", state: "Tamil Nadu" },
  { city: "Kolkata", state: "West Bengal" },
  { city: "Surat", state: "Gujarat" },
  { city: "Jaipur", state: "Rajasthan" },
  { city: "Lucknow", state: "Uttar Pradesh" },
  { city: "Gurugram", state: "Haryana" },
  { city: "Noida", state: "Uttar Pradesh" },
  { city: "Greater Noida", state: "Uttar Pradesh" },
  { city: "Chandigarh", state: "Chandigarh" },

  // Gujarat Cities & Towns
  { city: "Vadodara", state: "Gujarat" },
  { city: "Rajkot", state: "Gujarat" },
  { city: "Gandhinagar", state: "Gujarat" },
  { city: "Bhavnagar", state: "Gujarat" },
  { city: "Jamnagar", state: "Gujarat" },
  { city: "Junagadh", state: "Gujarat" },
  { city: "Anand", state: "Gujarat" },
  { city: "Navsari", state: "Gujarat" },
  { city: "Morbi", state: "Gujarat" },
  { city: "Bharuch", state: "Gujarat" },
  { city: "Mehsana", state: "Gujarat" },
  { city: "Vapi", state: "Gujarat" },
  { city: "Valsad", state: "Gujarat" },
  { city: "Bhuj", state: "Gujarat" },
  { city: "Gandhidham", state: "Gujarat" },
  { city: "Porbandar", state: "Gujarat" },
  { city: "Nadiad", state: "Gujarat" },
  { city: "Surendranagar", state: "Gujarat" },
  { city: "Ankleshwar", state: "Gujarat" },
  { city: "Godhra", state: "Gujarat" },
  { city: "Palanpur", state: "Gujarat" },
  { city: "Patan", state: "Gujarat" },
  { city: "Veraval", state: "Gujarat" },
  { city: "Botad", state: "Gujarat" },
  { city: "Himatnagar", state: "Gujarat" },
  { city: "Amreli", state: "Gujarat" },
  { city: "Deesa", state: "Gujarat" },
  { city: "Mundra", state: "Gujarat" },

  // Maharashtra Hubs
  { city: "Thane", state: "Maharashtra" },
  { city: "Navi Mumbai", state: "Maharashtra" },
  { city: "Nagpur", state: "Maharashtra" },
  { city: "Nashik", state: "Maharashtra" },
  { city: "Aurangabad (Chhatrapati Sambhajinagar)", state: "Maharashtra" },
  { city: "Kolhapur", state: "Maharashtra" },
  { city: "Solapur", state: "Maharashtra" },
  { city: "Amravati", state: "Maharashtra" },
  { city: "Nanded", state: "Maharashtra" },
  { city: "Sangli", state: "Maharashtra" },
  { city: "Jalgaon", state: "Maharashtra" },
  { city: "Akola", state: "Maharashtra" },
  { city: "Latur", state: "Maharashtra" },
  { city: "Dhule", state: "Maharashtra" },
  { city: "Ahmednagar", state: "Maharashtra" },
  { city: "Chandrapur", state: "Maharashtra" },
  { city: "Panvel", state: "Maharashtra" },
  { city: "Satara", state: "Maharashtra" },

  // Rajasthan Hubs
  { city: "Udaipur", state: "Rajasthan" },
  { city: "Jodhpur", state: "Rajasthan" },
  { city: "Kota", state: "Rajasthan" },
  { city: "Bikaner", state: "Rajasthan" },
  { city: "Ajmer", state: "Rajasthan" },
  { city: "Bhilwara", state: "Rajasthan" },
  { city: "Alwar", state: "Rajasthan" },
  { city: "Sikar", state: "Rajasthan" },
  { city: "Mount Abu", state: "Rajasthan" },

  // North & NCR Hubs
  { city: "Faridabad", state: "Haryana" },
  { city: "Ghaziabad", state: "Uttar Pradesh" },
  { city: "Kanpur", state: "Uttar Pradesh" },
  { city: "Agra", state: "Uttar Pradesh" },
  { city: "Varanasi", state: "Uttar Pradesh" },
  { city: "Prayagraj (Allahabad)", state: "Uttar Pradesh" },
  { city: "Meerut", state: "Uttar Pradesh" },
  { city: "Bareilly", state: "Uttar Pradesh" },
  { city: "Aligarh", state: "Uttar Pradesh" },
  { city: "Moradabad", state: "Uttar Pradesh" },
  { city: "Saharanpur", state: "Uttar Pradesh" },
  { city: "Gorakhpur", state: "Uttar Pradesh" },
  { city: "Firozabad", state: "Uttar Pradesh" },
  { city: "Jhansi", state: "Uttar Pradesh" },
  { city: "Mathura", state: "Uttar Pradesh" },
  { city: "Ayodhya", state: "Uttar Pradesh" },
  { city: "Sonipat", state: "Haryana" },
  { city: "Panipat", state: "Haryana" },
  { city: "Karnal", state: "Haryana" },
  { city: "Hisar", state: "Haryana" },
  { city: "Rohtak", state: "Haryana" },
  { city: "Panchkula", state: "Haryana" },
  { city: "Ludhiana", state: "Punjab" },
  { city: "Amritsar", state: "Punjab" },
  { city: "Jalandhar", state: "Punjab" },
  { city: "Patiala", state: "Punjab" },
  { city: "Bathinda", state: "Punjab" },
  { city: "Mohali", state: "Punjab" },
  { city: "Dehradun", state: "Uttarakhand" },
  { city: "Haridwar", state: "Uttarakhand" },
  { city: "Rishikesh", state: "Uttarakhand" },
  { city: "Shimla", state: "Himachal Pradesh" },
  { city: "Srinagar", state: "Jammu & Kashmir" },
  { city: "Jammu", state: "Jammu & Kashmir" },

  // Central India
  { city: "Indore", state: "Madhya Pradesh" },
  { city: "Bhopal", state: "Madhya Pradesh" },
  { city: "Jabalpur", state: "Madhya Pradesh" },
  { city: "Gwalior", state: "Madhya Pradesh" },
  { city: "Ujjain", state: "Madhya Pradesh" },
  { city: "Sagar", state: "Madhya Pradesh" },
  { city: "Ratlam", state: "Madhya Pradesh" },
  { city: "Raipur", state: "Chhattisgarh" },
  { city: "Bhilai", state: "Chhattisgarh" },
  { city: "Bilaspur", state: "Chhattisgarh" },

  // Karnataka & South
  { city: "Mysuru (Mysore)", state: "Karnataka" },
  { city: "Hubballi-Dharwad", state: "Karnataka" },
  { city: "Mangaluru (Mangalore)", state: "Karnataka" },
  { city: "Belagavi (Belgaum)", state: "Karnataka" },
  { city: "Davanagere", state: "Karnataka" },
  { city: "Ballari (Bellary)", state: "Karnataka" },
  { city: "Shivamogga (Shimoga)", state: "Karnataka" },
  { city: "Tumakuru (Tumkur)", state: "Karnataka" },
  { city: "Udupi", state: "Karnataka" },
  { city: "Kochi", state: "Kerala" },
  { city: "Thiruvananthapuram", state: "Kerala" },
  { city: "Kozhikode", state: "Kerala" },
  { city: "Thrissur", state: "Kerala" },
  { city: "Kollam", state: "Kerala" },
  { city: "Kannur", state: "Kerala" },
  { city: "Palakkad", state: "Kerala" },
  { city: "Coimbatore", state: "Tamil Nadu" },
  { city: "Madurai", state: "Tamil Nadu" },
  { city: "Tiruchirappalli (Trichy)", state: "Tamil Nadu" },
  { city: "Salem", state: "Tamil Nadu" },
  { city: "Tirunelveli", state: "Tamil Nadu" },
  { city: "Tiruppur", state: "Tamil Nadu" },
  { city: "Vellore", state: "Tamil Nadu" },
  { city: "Erode", state: "Tamil Nadu" },
  { city: "Warangal", state: "Telangana" },
  { city: "Nizamabad", state: "Telangana" },
  { city: "Karimnagar", state: "Telangana" },
  { city: "Khammam", state: "Telangana" },
  { city: "Visakhapatnam", state: "Andhra Pradesh" },
  { city: "Vijayawada", state: "Andhra Pradesh" },
  { city: "Guntur", state: "Andhra Pradesh" },
  { city: "Nellore", state: "Andhra Pradesh" },
  { city: "Kurnool", state: "Andhra Pradesh" },
  { city: "Rajahmundry", state: "Andhra Pradesh" },
  { city: "Tirupati", state: "Andhra Pradesh" },
  { city: "Kakinada", state: "Andhra Pradesh" },
  { city: "Puducherry", state: "Puducherry" },
  { city: "Goa (Panaji)", state: "Goa" },
  { city: "Margao", state: "Goa" },

  // East & North-East
  { city: "Patna", state: "Bihar" },
  { city: "Gaya", state: "Bihar" },
  { city: "Bhagalpur", state: "Bihar" },
  { city: "Muzaffarpur", state: "Bihar" },
  { city: "Ranchi", state: "Jharkhand" },
  { city: "Jamshedpur", state: "Jharkhand" },
  { city: "Dhanbad", state: "Jharkhand" },
  { city: "Bokaro", state: "Jharkhand" },
  { city: "Bhubaneswar", state: "Odisha" },
  { city: "Cuttack", state: "Odisha" },
  { city: "Rourkela", state: "Odisha" },
  { city: "Puri", state: "Odisha" },
  { city: "Howrah", state: "West Bengal" },
  { city: "Durgapur", state: "West Bengal" },
  { city: "Asansol", state: "West Bengal" },
  { city: "Siliguri", state: "West Bengal" },
  { city: "Guwahati", state: "Assam" },
  { city: "Agartala", state: "Tripura" },
  { city: "Shillong", state: "Meghalaya" },
  { city: "Aizawl", state: "Mizoram" },
  { city: "Imphal", state: "Manipur" },
];

/** Search matching cities by city or state query */
export function searchIndianCities(query: string, maxResults = 8): IndianCity[] {
  if (!query || !query.trim()) {
    return INDIAN_CITIES.slice(0, maxResults);
  }
  const clean = query.trim().toLowerCase();

  const exactCityMatches: IndianCity[] = [];
  const prefixCityMatches: IndianCity[] = [];
  const containsCityMatches: IndianCity[] = [];
  const stateMatches: IndianCity[] = [];

  for (const item of INDIAN_CITIES) {
    const c = item.city.toLowerCase();
    const s = item.state.toLowerCase();

    if (c === clean) {
      exactCityMatches.push(item);
    } else if (c.startsWith(clean)) {
      prefixCityMatches.push(item);
    } else if (c.includes(clean)) {
      containsCityMatches.push(item);
    } else if (s.includes(clean)) {
      stateMatches.push(item);
    }
  }

  const combined = [
    ...exactCityMatches,
    ...prefixCityMatches,
    ...containsCityMatches,
    ...stateMatches,
  ];

  // Return deduplicated list up to maxResults
  const seen = new Set<string>();
  const results: IndianCity[] = [];

  for (const item of combined) {
    const key = `${item.city}, ${item.state}`;
    if (!seen.has(key)) {
      seen.add(key);
      results.push(item);
      if (results.length >= maxResults) break;
    }
  }

  return results;
}
