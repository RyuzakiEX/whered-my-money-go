// DELIBERATE VIOLATION — must fail lint. Do not "fix" this file.
// Matrix row 6: components/** must never import lib/server.
//
// This is the fixture M0-B02 names explicitly. A component importing server
// code either breaks the build by pulling server-only modules into the client
// bundle, or — worse — succeeds and ships database access to the browser.
// Data is fetched in a Server Component and passed down as props.

import { listAccounts } from '@/lib/server/queries/accounts';

export function BrokenAccountList() {
  const accounts = listAccounts();
  return <div>{String(accounts)}</div>;
}
