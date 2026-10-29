// Server Component. Only NavLink, inside it, is a client boundary.

import { NAV_ITEMS } from '@/components/shell/nav-items';
import { NavLink } from '@/components/shell/nav-link';
import { Badge } from '@/components/ui/badge';

export function SidebarNav() {
  return (
    <nav aria-label="Main">
      <ul className="flex flex-col gap-1">
        {NAV_ITEMS.map(({ label, href, Icon, v2 }) => (
          <li key={href}>
            <NavLink href={href} label={label}>
              <Icon className="size-4 shrink-0" aria-hidden />
              <span>{label}</span>
              {v2 ? (
                // Inside the link, so it is part of the accessible name.
                <Badge variant="outline" className="ml-auto">
                  V2
                </Badge>
              ) : null}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
