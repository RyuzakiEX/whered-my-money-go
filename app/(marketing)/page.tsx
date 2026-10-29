// M0-B10 demonstration: a build that fails must not deploy. Reverted next commit.
import { doesNotExist } from './does-not-exist';
void doesNotExist;
export default function HomePage() {
  return (
    <main>
      <h1>Where&rsquo;d My Money Go</h1>
      <p>
        A simple budgeting app that answers one question: where&rsquo;d my money
        go?
      </p>
      <p>
        Scaffold only — no features yet. See <code>tasks/milestones.md</code>.
      </p>
    </main>
  );
}
