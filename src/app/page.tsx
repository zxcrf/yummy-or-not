/* Home page — mounts the auth gate, which renders either the login screen or
   the responsive app shell depending on the session. */

import AppGate from "@/components/app/AppGate";

export default function Home() {
  return <AppGate />;
}
