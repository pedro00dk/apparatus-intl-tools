# @\_apparatus\_/intl-tools

[![bundle size](https://deno.bundlejs.com/?q=@_apparatus_/intl-tools&badge=detailed)](https://bundlejs.com/?q=@_apparatus_/intl-tools)

A small set of tools to support application internationalization.

## Installation

```sh
npm install @_apparatus_/intl-tools
```

## Features

-   🌍 **Dynamic loading** - Load translations for different locales and modules on demand.
-   🔌 **Pluggable formatters** - Integrate with external libraries like MessageFormat (ICU), Fluent, etc.
-   🪆 **Nesting** - Reference translations within translations using `<:nested.key/>` syntax.
-   🏷️ **HTML-like Tags** - Wrap content with tags for rich text formatting.
-   ✅ **Type safety** - Fully typed translation keys with TypeScript autocomplete.
-   📦 **Module system** - Organize translations by feature modules for better code splitting.

## Examples

### Basic usage

```ts
import { createLocalizer } from '@_apparatus_/intl-tools'

// Define your translations structure
// A good idea is to import types from JSON
type Translations = {
    common: {
        greeting: string
        user: {
            welcome: string
        }
    }
    dashboard: {
        title: string
        stats: string
    }
}

// Create localizer instance
const localizer = createLocalizer<Translations>({
    load: async (locale, module) => {
        // Load translations synchronously or asynchronously
        const response = await fetch(`/locales/${locale}/${module}.json`)
        return response.json()
    },
})
const { t } = localizer

// Set active locale and modules
localizer.setLocales('en-US')
localizer.setModules('common', 'dashboard')

// Wait for pending locales and modules
await localizer.wait()

// Access typed translations
console.log(t.common.greeting())
console.log(t.common.user.welcome())
console.log(t.dashboard.title())
```

### Switching locales

```ts
const localizer = createLocalizer(...)
const { t } = localizer

// Set default locale
localizer.setLocales('en-US')
localizer.setModules('common')
await localizer.wait()

console.log(t.common.greeting()) // "Hello"

// Switch to Portuguese
localizer.setLocales('pt-BR')
await localizer.wait()
console.log(t.common.greeting()) // "Olá"

// Locale fallbacks (tries first locale, falls back to second)
localizer.setLocales('pt-BR', 'en-US')
```

### Translation nesting

```ts
// Translation files:
// common.json
{
    "app": "MyApp",
    "welcome": "Welcome to <:app/>!",
    "footer": "© 2024 <:app/>. All rights reserved.",
    "cross_module": "Check <:dashboard:title/> for details"
}

const { t } = localizer
t.common.welcome() // "Welcome to MyApp!"
t.common.footer() // "© 2024 MyApp. All rights reserved."
t.common.cross_module() // "Check Dashboard for details"
```

### Custom formatters

```ts
import { createLocalizer } from '@_apparatus_/intl-tools'
import IntlMessageFormat from 'intl-messageformat'

const localizer = createLocalizer<Translations>({
    ...
    parse: (locale, module, key, raw) => {
        const formatter = new IntlMessageFormat(raw, locale)
        return values => formatter.format(values) as string
    },
})
const { t } = localizer

// "You have {count, plural, =0 {no messages} one {# message} other {# messages}}."
t.common.messages({ count: 0 }) // "You have no messages."
t.common.messages({ count: 1 }) // "You have 1 message."
t.common.messages({ count: 5 }) // "You have 5 messages."
```

### HTML tags for rich Content

```ts
const localizer = createLocalizer<Translations, JSX.Element>({
    ...
    tag: (children, tag) => {
        // Fallback transform unmatched tags to elements
        return <Dynamic tag={tag}>{children}</Dynamic>
    },
})

// Translation: "Read our <b><a-terms>terms of service</a-terms></b>."
const { t } = localizer
const content = t.common.legal({}, { 'a-terms': c => <a href='/terms'>{c}</a> })
// Renders: "Read our <b><a href="/terms">terms of service</a></b>."
```

### Hook into rendering libraries lifecycle

```tsx
import { createSignal, createEffect, Show } from 'solid-js'
import { createLocalizer } from '@_apparatus_/intl-tools'

// Solid-js Suspense example
const localizer = createLocalizer<Translations>({
    notify: (_, __, promise) => createResource(() => promise)[0],
})
localizer.setLocales('en-US')
localizer.setModules('common', 'dashboard')
const { t } = localizer

const App = () => (
    <Skeleton fallback='loading...'>
        <div>
            <h1>{t.dashboard.title()}</h1>
            <p>{t.common.greeting()}</p>
        </div>
    </Skeleton>
)
```

### Untyped keys

```ts
const { t } = localizer

// Typed access
const greetingType = getStrictUserPreferredGreeting() // 'formal' | 'informal'
t.common.greeting[greetingType]() // ✅ Type safe

// Key segment not known at compile time
const greetingType = getUserPreferredGreeting() // string
t.common.greeting[greetingType]() // ⛔ Type error
t.common.greeting[greetingType].$() // ⚠️ Bypass error

// Access deeply nested untyped keys
t.dashboard.user.profile.settings.$()
```
