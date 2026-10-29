// The class-name merger the shadcn primitives use. Generated primitives import
// the `cn` package directly; this re-export serves the components.json `utils`
// alias, so templates that go through the alias resolve too.
//
// Not in lib/utils: that layer is framework-agnostic (stdlib and Intl only,
// source-structure.md matrix row 4), and this is Tailwind-specific.

export { cn } from 'cn';
