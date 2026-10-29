import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';

import { ThemeToggle } from '@/components/theme/theme-toggle';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

import { OverlayDemos, ToastDemo } from './interactive';

// Every installed primitive, in every state that applies, so a token change
// that breaks one variant is caught here rather than by a user
// (docs/architecture/frontend-architecture.md#shadcnui-conventions).
//
// Dev only: production builds render the 404 page instead.

export const metadata: Metadata = {
  title: 'Kitchen sink',
  robots: { index: false, follow: false },
};

const STATES = ['default', 'hover', 'focus', 'disabled', 'error'] as const;
type State = (typeof STATES)[number];

/** Props that put a primitive into `state`. See the variants in globals.css. */
function stateProps(state: State) {
  switch (state) {
    case 'default':
      return {};
    case 'hover':
      return { 'data-force-state': 'hover' };
    case 'focus':
      return { 'data-force-state': 'focus' };
    case 'disabled':
      return { disabled: true };
    case 'error':
      return { 'aria-invalid': true };
  }
}

function StateGrid({
  name,
  render,
}: {
  name: string;
  /** null = this state does not apply to the primitive. */
  render: (state: State, props: ReturnType<typeof stateProps>) => ReactNode;
}) {
  return (
    <div className="grid grid-cols-[8rem_repeat(5,minmax(0,1fr))] items-center gap-3">
      <div className="text-sm font-medium">{name}</div>
      {STATES.map((state) => (
        <div key={state} className="flex flex-wrap items-center gap-2">
          {render(state, stateProps(state)) ?? (
            <span className="text-sm text-muted-foreground">
              —<span className="sr-only">not applicable</span>
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4" aria-labelledby={slug(title)}>
      <h2 id={slug(title)} className="text-lg font-semibold">
        {title}
      </h2>
      {children}
      <Separator />
    </section>
  );
}

function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

const BUTTON_VARIANTS = [
  'default',
  'secondary',
  'outline',
  'ghost',
  'destructive',
  'link',
] as const;
const BADGE_VARIANTS = [
  'default',
  'secondary',
  'outline',
  'ghost',
  'destructive',
  'link',
] as const;

const SWATCHES = [
  ['background', 'foreground'],
  ['card', 'card-foreground'],
  ['primary', 'primary-foreground'],
  ['secondary', 'secondary-foreground'],
  ['muted', 'muted-foreground'],
  ['accent', 'accent-foreground'],
] as const;

export default function KitchenSinkPage() {
  if (process.env.NODE_ENV === 'production') notFound();

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-10 p-6">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Kitchen sink</h1>
          <p className="text-muted-foreground">
            Every primitive, every state. Switch the theme to check both.
          </p>
        </div>
        <ThemeToggle />
      </header>

      <div
        aria-hidden
        className="grid grid-cols-[8rem_repeat(5,minmax(0,1fr))] gap-3 text-xs font-medium tracking-wide text-muted-foreground uppercase"
      >
        <span />
        {STATES.map((s) => (
          <span key={s}>{s}</span>
        ))}
      </div>

      <Section title="Tokens">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {SWATCHES.map(([bg, fg]) => (
            <div
              key={bg}
              className="rounded-lg border p-3"
              style={{
                background: `var(--${bg})`,
                color: `var(--${fg})`,
              }}
            >
              <div className="font-medium">{fg}</div>
              <div className="text-sm">on {bg}</div>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-6 text-sm">
          {/* Money direction and status are never colour alone: sign and
              text carry the meaning too. */}
          <span className="text-income">+ ₱1,234.50 income</span>
          <span className="text-expense">− ₱987.00 expense</span>
          <span className="text-destructive">Destructive text</span>
          <span className="text-status-green">🟢 Comfortable</span>
          <span className="text-status-amber">🟡 Tight</span>
          <span className="text-status-red">🔴 Over</span>
        </div>
      </Section>

      <Section title="Type scale">
        <p className="text-xs">text-xs — The quick brown fox, ₱1,234.50</p>
        <p className="text-4xl font-semibold">
          text-4xl — The quick brown fox, ₱1,234.50
        </p>
      </Section>

      <Section title="Button">
        {BUTTON_VARIANTS.map((variant) => (
          <StateGrid
            key={variant}
            name={variant}
            render={(_, props) => (
              <Button variant={variant} {...props}>
                Save
              </Button>
            )}
          />
        ))}
        <StateGrid
          name="sizes"
          render={(state, props) =>
            state === 'default' ? (
              <>
                <Button size="xs">xs</Button>
                <Button size="sm">sm</Button>
                <Button size="lg">lg</Button>
              </>
            ) : state === 'error' ? null : (
              <Button size="sm" {...props}>
                sm
              </Button>
            )
          }
        />
      </Section>

      <Section title="Input, Label, Field">
        <StateGrid
          name="input"
          render={(state, props) => (
            <Input
              aria-label={`Amount (${state})`}
              placeholder="₱0.00"
              {...props}
            />
          )}
        />
        <StateGrid
          name="field"
          render={(state, props) =>
            state === 'hover' ? null : (
              <Field
                data-disabled={state === 'disabled' || undefined}
                data-invalid={state === 'error' || undefined}
              >
                <FieldLabel htmlFor={`field-${state}`}>Amount</FieldLabel>
                <Input id={`field-${state}`} placeholder="₱0.00" {...props} />
                {state === 'error' ? (
                  <FieldError>Enter an amount above ₱0.00.</FieldError>
                ) : (
                  <FieldDescription>In pesos.</FieldDescription>
                )}
              </Field>
            )
          }
        />
        <StateGrid
          name="label"
          render={(state) =>
            state === 'default' ? <Label>Account name</Label> : null
          }
        />
      </Section>

      <Section title="Select">
        <StateGrid
          name="select"
          render={(state, props) => (
            <Select disabled={state === 'disabled'}>
              <SelectTrigger
                aria-label={`Account (${state})`}
                className="w-40"
                {...props}
              >
                <SelectValue placeholder="Account" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="cash">Cash</SelectItem>
                <SelectItem value="bank">Bank</SelectItem>
                <SelectItem value="gcash">GCash</SelectItem>
              </SelectContent>
            </Select>
          )}
        />
      </Section>

      <Section title="Tabs">
        <StateGrid
          name="trigger"
          render={(state, props) =>
            state === 'error' ? null : (
              <Tabs defaultValue="month">
                <TabsList>
                  <TabsTrigger value="month">Month</TabsTrigger>
                  <TabsTrigger value="year" {...props}>
                    Year
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            )
          }
        />
        <Tabs defaultValue="month" className="max-w-sm">
          <TabsList>
            <TabsTrigger value="month">Month</TabsTrigger>
            <TabsTrigger value="year">Year</TabsTrigger>
          </TabsList>
          <TabsContent value="month">This month&apos;s spending.</TabsContent>
          <TabsContent value="year">This year&apos;s spending.</TabsContent>
        </Tabs>
      </Section>

      <Section title="Overlays: dialog, sheet, drawer, popover, dropdown menu">
        <p className="text-sm text-muted-foreground">
          Triggers are shown in each state; open one to check its content in the
          current theme.
        </p>
        <OverlayDemos />
      </Section>

      <Section title="Badge">
        <div className="flex flex-wrap gap-2">
          {BADGE_VARIANTS.map((variant) => (
            <Badge key={variant} variant={variant}>
              {variant}
            </Badge>
          ))}
        </div>
      </Section>

      <Section title="Alert">
        <Alert>
          <AlertTitle>Budget updated</AlertTitle>
          <AlertDescription>Groceries is now ₱8,000 a month.</AlertDescription>
        </Alert>
        <Alert variant="destructive">
          <AlertTitle>Shortfall ahead</AlertTitle>
          <AlertDescription>
            Your projected balance drops below ₱0 on 14 November.
          </AlertDescription>
        </Alert>
      </Section>

      <Section title="Card">
        <Card className="max-w-sm">
          <CardHeader>
            <CardTitle>Safe to Spend</CardTitle>
            <CardDescription>Until your next payday</CardDescription>
          </CardHeader>
          <CardContent className="text-3xl font-semibold">
            ₱4,210.00
          </CardContent>
          <CardFooter className="text-sm text-muted-foreground">
            🟢 Comfortable
          </CardFooter>
        </Card>
      </Section>

      <Section title="Table">
        <Table>
          <TableCaption>Recent transactions</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Description</TableHead>
              <TableHead className="text-right">Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell>28 Oct</TableCell>
              <TableCell>Salary</TableCell>
              <TableCell className="text-right text-income">
                + ₱25,000.00
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell>27 Oct</TableCell>
              <TableCell>Groceries</TableCell>
              <TableCell className="text-right text-expense">
                − ₱1,845.50
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </Section>

      <Section title="Progress and skeleton">
        <div className="flex max-w-sm flex-col gap-3">
          <Progress value={0} aria-label="Empty" />
          <Progress value={45} aria-label="45 percent" />
          <Progress value={100} aria-label="Full" />
        </div>
        <div className="flex max-w-sm flex-col gap-2">
          <Skeleton className="h-6 w-1/2" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      </Section>

      <Section title="Toast (sonner)">
        <ToastDemo />
      </Section>
    </main>
  );
}
