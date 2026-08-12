// Every shared Firestore listener in the app, closable at once.
//
// Listeners now outlive their last consumer by a grace period so navigation is
// free (see subscriptionRegistry). That is exactly wrong across a SIGN-OUT: a
// warm listener on the previous user's documents keeps running with revoked
// permissions, produces error toasts, and would hand the next person to sign in
// whatever was still cached. Registries register here so logout can close them
// all without knowing what any of them subscribe to.
const registries = new Set()

export function registerLiveData(registry) {
  registries.add(registry)
  return registry
}

export function closeAllLiveData() {
  for (const r of registries) r.clear()
}
