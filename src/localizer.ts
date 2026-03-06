/**
 * Base translation resource type.
 */
export type Resource = {
    [_ in string]: Resource | string
}

/**
 * Function type to format resolved translation values.
 *
 * This function produces a string or `TTag` based on the provided arguments.
 *
 * @param TTag Tag type.
 */
type Formatter<TTag> = {
    <T extends [_?: object]>(...args: T): string
    <T extends [_?: object, _?: Tagger<TTag>]>(...args: T): string | TTag
}

/**
 * Wrapper functions for transforming html-like tags inside translations.
 *
 * @param TTag Tag type.
 */
export type Tagger<TTag> = {
    [_ in string]: (children: (string | TTag)[], tag: string) => string | TTag
}

/**
 * Resolve nested keys in objects to create a centralized getter to all keys in `TValue`.
 * - If `TValue` is an object, recursively return its internal keys.
 * - If `TValue` is a string, return a parameterized {@linkcode Formatter}.
 *
 * @param TValue Value to nest or to return getter.
 */
export type Translation<TValue, TTag> = TValue extends object
    ? { [Key in keyof TValue]: Translation<TValue[Key], TTag> }
    : Formatter<TTag>

/**
 * Fallback provides an escape hatch to untyped translation keys. Untyped keys require an extra property access to `$`.
 */
type Fallback<TTag> = { [_ in string]: Fallback<TTag> } & Formatter<TTag>

/**
 * Create a localizer that orchestrates translation resource loading for multiple locales and modules.
 *
 * Locales and modules can be added or modified dynamically. Translation resources are downloaded when locales or
 * modules change. Resources are fetched using the `params.load` provided by the caller.
 *
 * The following translation utilities are provided:
 * - Nesting: Self closing HTML tags starting with `.` or `:`.
 *   - `<.nested.key/>`: A key in the same module as the key referencing it.
 *   - `<:module.nested.key/>`: A key in a different module.
 * - Tagging: HTML tags without `:` (set `TTag` and `params.tag` for configuration).
 *   - `<tag/>`: Self closing tag.
 *   - `<a>link</a>`: Open and close tag.
 *   - `<a><.nested.key/></a>`: Tags may also contain nested translations.
 *   - `<a><b/><c><d/></c></a><e/>`: Tags can have nested tags.
 *
 * @param params.load Function to load the translation resources for a given locale and module.
 * @param params.notify Function to notify when a translation resource is loaded, and then when a key is accessed.
 * @param params.parse Function to parse the translation resource into a formatter function.
 * @param params.tag Function to tag the translation resources used as fallback.
 * @param TTranslations Type of the translations to be loaded, used to type the translation keys.
 * @param TTag Type of the tag used to wrap the translation resources.
 */
export const createLocalizer = <TTranslations extends Resource, TTag = string>(params: {
    load: (locale: string, module: string) => Resource | Promise<Resource>
    notify?: (locale: string, module: string, promise: Promise<Resource>) => (key: string[], raw?: unknown) => void
    parse?: (locale: string, key: string[], value: string) => Formatter<TTag>
    tag?: Tagger<TTag>[string]
}) => {
    params.notify ??= () => () => {}
    params.parse ??= (_, __, value) => () => value
    params.tag ??= children => children.join('')

    let locales = Object.freeze([] as string[])
    let modules = Object.freeze([] as string[])

    const subscriptions = new Set<(locales: readonly string[], modules: readonly string[]) => void>()
    const promises: { [_ in string]?: { [_ in string]?: Promise<Resource> } } = {}
    const notifiers: { [_ in string]?: { [_ in string]?: ReturnType<NonNullable<typeof params.notify>> } } = {}
    const resources: { [_ in string]?: Resource } = {}
    const formatters: { [_ in string]?: ReturnType<NonNullable<typeof params.parse>> } = {}

    const setLocales = (...locales_: string[]) => ((locales = Object.freeze([...new Set(locales_)])), reload())
    const setModules = (...modules_: string[]) => ((modules = Object.freeze([...new Set(modules_)])), reload())

    const subscribe = (handler: (locales: readonly string[], modules: readonly string[]) => void) => (
        subscriptions.add(handler),
        handler(locales, modules)
    )
    const unsubscribe = (handler: (locales: readonly string[], modules: readonly string[]) => void) =>
        subscriptions.delete(handler)

    const wait = () => Promise.all(Object.values(promises).flatMap(modules => Object.values(modules!)))

    const reload = () => {
        locales
            .flatMap(locale => modules.map(module => ({ locale, module })))
            .filter(({ locale, module }) => !promises[locale]?.[module])
            .forEach(({ locale, module }) => {
                const promise = Promise.try(() => params.load(locale, module))
                    .catch<Resource>(error => (console.warn('intl - load error:', { locale, module, error }), {}))
                    .then(resource => ((resources[locale] ??= {})[module] = resource))
                ;(promises[locale] ??= {})[module] = promise
                ;(notifiers[locale] ??= {})[module] = params.notify!(locale, module, promise)
            })
        subscriptions.forEach(handler => handler(locales, modules))
    }

    const read = (locale: string, key: string[]): string => {
        const resource = resources[locale]
        const value = key.reduce<string | Resource | undefined>(($, k) => ($ as Resource | undefined)?.[k], resource)
        if (!value) throw Error('intl - key missing')
        if (typeof value === 'object') throw Error('intl - key partial')
        notifiers[locale]![key[0]]!(key, value)
        return value.replaceAll(/<[:.](.+?)\/>/g, (_, tag: string) => {
            const nestedKey = tag.split('.')
            return read(locale, tag.includes(':') ? nestedKey : [key[0], ...nestedKey])
        })
    }

    const format = (key: string[], values?: Parameters<Formatter<TTag>>[0]) => {
        for (const locale of locales) {
            try {
                return (formatters[`${locale}:${key}`] ??= params.parse!(locale, key, read(locale, key)))(values)
            } catch (error) {
                const hasResource = !!resources[locale]?.[key[0]]
                if (hasResource) console.warn('intl - error:', { error, resources, locale, key, values })
            }
        }
        return `${locales.join('|')}:${key.join('.')}`
    }

    const tagger = (text: string, tags: Tagger<TTag>) => {
        const stack: (TTag | string)[][] = [[]]
        let done = 0
        for (const { '0': match, '1': t, index } of text.matchAll(/<\/?([^:>/\s]+)\/?>/g)) {
            const children = stack.at(-1)!
            if (done < index) children.push(text.slice(done, index))
            if (match.at(-2) === '/') children.push((tags[t] ?? params.tag)([], t))
            else if (match.at(1) !== '/') stack.push([])
            else {
                if (stack.length > 1) stack.pop()
                stack.at(-1)!.push((tags[t] ?? params.tag)(children, t))
            }
            done = index + match.length
        }
        if (done < text.length) stack.at(-1)!.push(text.slice(done))
        return params.tag!(stack.flat(), '')
    }

    const t = createProxy<TTranslations, TTag>(format, tagger)

    return {
        locales: () => locales,
        modules: () => modules,
        setLocales,
        setModules,
        subscribe,
        unsubscribe,
        wait,
        read,
        format,
        tagger,
        t,
    }
}

/**
 * Create a typed proxy tree for easier access to resource translations.
 *
 * @param format Function to resolve translation strings.
 * @param tagger Function to tag resolved translation strings.
 * @param TTranslations Type of the translations to be loaded, used to type the translation keys.
 */
const createProxy = <TTranslations extends Resource, TTag>(
    format: (key: string[], values?: Parameters<Translation<string, TTag>>[0]) => string,
    tagger: (text: string, tags: Tagger<TTag>) => string | TTag,
): Translation<TTranslations, TTag> & { $: Fallback<TTag> } => {
    type Proxy = { key: string[]; children: { [_ in string]: Proxy } }
    const proxy = (key: string[]) => Object.assign(() => {}, { key, children: {} })
    const handler: ProxyHandler<Proxy> = {
        apply: (target, _, [values, tags]: Parameters<Translation<string, TTag>>) => {
            const text = format(target.key, values)
            return tags ? tagger(text, tags) : text
        },
        get: (target, p, receiver: unknown) => {
            if (typeof p === 'symbol' || p === '$') return receiver
            return (target.children[p] ??= new Proxy(proxy([...target.key, p]), handler))
        },
    }
    return new Proxy(proxy([]), handler) as unknown as Translation<TTranslations, TTag> & { $: Fallback<TTag> }
}
