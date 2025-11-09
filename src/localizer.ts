/**
 * Resource type that must be returned when loading translations.
 */
export type Resource = { [_ in string]: Resource | string }

/**
 * Function type to format resolved translation values.
 */
type Formatter<TTag> = {
    <T extends [_?: object]>(...args: T): string
    <T extends [_?: object, _?: Tagger<TTag>]>(...args: T): TTag | string
}

/**
 * Tagger describes wrappers for {@linkcode createTagger}.
 *
 * @param TTag Tag aggregation type.
 */
export type Tagger<TTag> = { [_ in string]: (children: (TTag | string)[], tag: string) => TTag | string }

/**
 * Translation nests translation objects' keys by using {@linkcode Nest} and create getters to final values.
 * If `TValue` it is an object, return its nested internal keys. Otherwise, return a parameterized getter.
 *
 * @param TValue Value nest or to return getter.
 */
export type Translation<TValue, TTag> = TValue extends object
    ? UnionToIntersection<{ [k in keyof TValue]: Nest<k, TValue[k], TTag> }[keyof TValue]>
    : TValue extends string
    ? Formatter<TTag>
    : never

/**
 * Nest splits dotted keys into nested objects.
 * For a `TKey` `TValue` pair, create a nested object for each `.` in `TKey`. The original `TKey` is still kept.
 * `TValue` is applied to {@linkcode Translation}. Non-existent keys can be accessed through {@linkcode Fallback}.
 *
 * @param TKey Key to nest.
 * @param TValue Key value to nest.
 */
type Nest<TKey extends PropertyKey, TValue, TTag> = {
    [_ in TKey]: Translation<TValue, TTag> & Fallback<TTag>
} & (TKey extends `${infer TPre}.${infer TSuf}` ? { [_ in TPre]: Nest<TSuf, TValue, TTag> } : unknown) &
    Fallback<TTag>

/**
 * Fallback provides an escape hatch to untyped translation keys. Untyped keys require an extra property access to `$`.
 */
type Fallback<TTag> = { [_ in string]: Fallback<TTag> } & { $: Formatter<TTag> }

type UnionToIntersection<U> = (U extends unknown ? (k: U) => void : never) extends (k: infer I) => void ? I : never

/**
 * Create a localizer instance that orchestrate translation resource loading for multiple locales and modules.
 *
 * Locales and modules can be added or modified dynamically. Translation resources are downloaded when locales or
 * modules change. Resources are fetched using the `params.load` provided by the client.
 *
 * The following translation utilities are provided:
 * - Nesting: Self closing HTML tags starting with `:`.
 *   - `<:nested.key/>`: A key in the same module as the key referencing it.
 *   - `<:md:nested.key/>`: A key in the `md` module.
 * - Tagging: HTML tags without `:` (set `TTag` and `params.tag` for configuration).
 *   - `<tag/>`: Self closing tag.
 *   - `<a>link</a>`: Open and close tag.
 *   - `<a><:nested.key/></a> <a>{link}</a>`: Tags may also contain nested translations or ICU.
 *   - `<a><b/><c><d/></c></a><e/>`: Tags can have nested tags.
 *
 * @param params.load Function to load the translation resources for a given locale and module.
 * @param params.parse Function to parse the translation resource into a formatter function.
 * @param params.notify Function to notify when a translation resource is loaded, and then when a key is accessed.
 * @param params.tag Function to tag the translation resources, used to wrap the translation in a tag.
 * @param TTranslations Type of the translations to be loaded, used to type the translation keys.
 * @param TTag Type of the tag used to wrap the translation resources.
 */
export const createLocalizer = <TTranslations extends Resource, TTag = string>(params: {
    load: (locale: string, module: string) => Resource | Promise<Resource>
    parse?: (locale: string, module: string, key: string[], raw: string) => Formatter<TTag>
    notify?: (locale: string, module: string, promise: Promise<Resource>) => (key: string[], raw?: unknown) => void
    tag?: Parameters<typeof createTagger<TTag>>[0]
}) => {
    params.parse ??= (_, __, ___, raw) => () => raw
    params.notify ??= () => () => {}
    params.tag ??= children => children.join('')

    let locales = Object.freeze([] as string[])
    let modules = Object.freeze([] as string[])
    const subscriptions = new Set<(locales: readonly string[], modules: readonly string[]) => void>()
    const setLocales = (...locales_: string[]) => ((locales = Object.freeze([...new Set(locales_)])), reload())
    const setModules = (...modules_: string[]) => ((modules = Object.freeze([...new Set(modules_)])), reload())
    const subscribe = (handler: (locales: readonly string[], modules: readonly string[]) => void) => (
        subscriptions.add(handler), handler(locales, modules)
    )
    const unsubscribe = (handler: (locales: readonly string[], modules: readonly string[]) => void) =>
        subscriptions.delete(handler)

    const promises: { [_ in string]?: { [_ in string]?: Promise<Resource> } } = {}
    const resources: { [_ in string]?: { [_ in string]?: Resource } } = {}
    const notifiers: { [_ in string]?: { [_ in string]?: ReturnType<NonNullable<typeof params.notify>> } } = {}
    const formatters: { [_ in string]?: ReturnType<NonNullable<typeof params.parse>> } = {}

    const wait = () => Promise.all(locales.flatMap(locale => modules.map(module => promises[locale]![module]!)))

    const reload = () => {
        locales
            .flatMap(locale => modules.map(module => ({ locale, module })))
            .filter(({ locale, module }) => !promises[locale]?.[module])
            .forEach(({ locale, module }) => {
                const promise = Promise.try(() => params.load(locale, module))
                    .catch<Resource>(error => (console.warn('intl - load error:', { locale, module, error }), {}))
                    .then(resource => ((resources[locale] ??= {})[module] = resource))
                promises[locale] ??= {}
                promises[locale][module] = promise
                notifiers[locale] ??= {}
                notifiers[locale][module] = params.notify!(locale, module, promise)
            })
        subscriptions.forEach(handler => handler(locales, modules))
    }

    const read = (locale: string, module: string, key: string[]): string => {
        const resource = resources[locale]?.[module]
        const raw =
            resource?.[key.join('.')] ??
            key.reduce<string | Resource | undefined>(($, k) => ($ as Resource | undefined)?.[k], resource)
        notifiers[locale]![module]!(key, raw)
        if (!raw) throw Error('intl - key missing')
        if (typeof raw === 'object') throw Error('intl - key partial')
        return raw.replaceAll(/<:(.+?)\/>/g, (_, nestedId: string) => {
            const [key, ns = module] = nestedId.split(':').reverse()
            return read(locale, ns, key.split('.'))
        })
    }

    const format = (module: string, key: string[], values?: Parameters<Formatter<TTag>>[0]) => {
        for (const locale of locales) {
            const resource = resources[locale]?.[module]
            const id = `${locale}:${module}:${key}`
            try {
                return (formatters[id] ??= params.parse!(locale, module, [], read(locale, module, key)))(values)
            } catch (error) {
                if (resource) console.warn('intl - format error:', { locale, module, key, values, error })
            }
        }
        return `${locales.join('|')}:${module}:${key.join('.')}`
    }

    const tagger = createTagger<TTag>(params.tag)
    const proxy = createProxy<TTranslations, TTag>(format, tagger)

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
        t: proxy,
    }
}

/**
 * Create a parser to replace tags from `text` using `tag` and `tags` wrapper functions.
 *
 * Supported formats are `<tag>`, `</tag>`, and `<tag/>`. Unbalanced tags produce unexpected result, but never throw.
 * Tags containing the `:` character are ignored as they are used for nesting.
 *
 * The resulting children are passed to `tag` once again with an empty tag to aggregate them into a single value.
 * The result the root of a tree of type `T | string`.
 *
 * @param tag Fallback tagger.
 * @param text Text containing tags to parse.
 * @param tags Replacer for matching tags.
 * @param TTag Type of the tag used to wrap the translation resources.
 */
const createTagger =
    <TTag>(tag: Tagger<TTag>[string]) =>
    (text = '', tags: Tagger<TTag> = {}) => {
        const stack: (TTag | string)[][] = [[]]
        let done = 0
        for (const { '0': match, '1': t, index } of text.matchAll(/<\/?([^:>/\s]+)\/?>/g)) {
            const children = stack.at(-1)!
            if (done < index) children.push(text.slice(done, index))
            if (match.at(-2) === '/') children.push((tags[t] ?? tag)([], t))
            else if (match.at(1) !== '/') stack.push([])
            else {
                if (stack.length > 1) stack.pop()
                stack.at(-1)!.push((tags[t] ?? tag)(children, t))
            }
            done = index + match.length
        }
        if (done < text.length) stack.at(-1)!.push(text.slice(done))
        return tag(stack.flat(), '')
    }

/**
 * Create a typed proxy tree for easier access to resource translations.
 *
 * When resolving a translation, if it does not exist in the type, it will trigger a typescript error.
 * This behavior is useful to ensure that all translations are typed and available in the codebase. However, in some
 * cases it is necessary to access translations dynamically, where key parts might not be typed. A special `$` key
 * is provided to bypass the type checking.
 *
 * @param format {@linkcode createLocalizer} `format` function.
 * @param TTranslations Type of the translations to be loaded, used to type the translation keys.
 */
const createProxy = <TTranslations extends Resource, TTag>(
    format: (module: string, key: string[], values?: Parameters<Translation<string, TTag>>[0]) => string,
    tagger: ReturnType<typeof createTagger<TTag>>,
): Translation<TTranslations, TTag> => {
    type ProxyObject = { module: string; key: string[]; children: { [_ in string]: ProxyObject } }
    const proxyObject = (module: string, key: string[]) => Object.assign(() => {}, { module, key, children: {} })
    const proxyHandler: ProxyHandler<ProxyObject> = {
        apply: (target, _, [values, tags]: Parameters<Translation<string, TTag>>) => {
            const text = format(target.module, target.key, values)
            return tags ? tagger(text, tags) : text
        },
        get: (target, p, receiver: unknown) => {
            if (typeof p === 'symbol' || p === '$') return receiver
            const module = target.module || p
            const key = !target.module ? target.key : !target.key.length ? [p] : [...target.key, p]
            return (target.children[p] ??= new Proxy(proxyObject(module, key), proxyHandler))
        },
    }
    proxyObject('', [])()
    return new Proxy(proxyObject('', []), proxyHandler) as unknown as Translation<TTranslations, TTag>
}
