// Non-sensitive flag cookie — lets the server redirect returning users
// before first paint without ever seeing the actual address. The value
// is always "1" (or absent); the real address stays in localStorage.
export const HAS_ADDRESS_COOKIE = "govroll_has_address";
