# @\_apparatus\_/intl-tools

[![bundle size](https://deno.bundlejs.com/?q=@_apparatus_/intl-tools&badge=detailed)](https://bundlejs.com/?q=@_apparatus_/intl-tools)

A small set of tools to support application internationalization.

## Installation

```shell
npm install @_apparatus_/intl-tools
```

## Features

-   **Dynamic Loading:** Load translations for different locales and modules on demand.
-   **Plugable:** Customizable formatting using external libraries such as MessageFormat (IC), Fluent, etc.
-   **Nesting:** Nest translations using a simple `<:nested.key/>` syntax.
-   **Tagging:** Wrap translations with html-like tags for rich text formatting.
-   **Typed translations:** Provides a typed proxy to easier access to translations, ensuring type safety.

## Examples

### Basic Usage

```typescript
import { createLocalizer } from '@_apparatus_/intl-tools'

const localizer = createLocalizer<TTranslations, TTag>({
    load: (locale, module) => {
        /* load your translations dynamically */
    },
    parse: (locale: string, module: string, key: string[], raw: string) => {
        /* custom parser function for formatting library integrations */
    },
    notify: (locale: string, module: string, promise: Promise<Resource>) => {
        /* get notified when modules are being loaded and translations called for rendering library integrations */
    },
    tag: (children: TTag | string, tag: string) => {
        /* transform html-like tags inside translations for custom rendering */
    },
})
```
