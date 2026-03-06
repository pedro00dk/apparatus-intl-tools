import { expect, mock, test } from 'bun:test'
import { createLocalizer } from './localizer.ts'

const translations = {
    hi: 'hi',
    nest: { hi: '<:hi/>' },
    tags: '0<a>1<b/>2</a>3',
    u: '<a><b>',
    o: '</a></b>',
}
type Translations = { base: typeof translations }

const tags = (children: string[], tag: string) => `<${tag}>${children.join('')}</${tag}>`
const load = (locale: string) => {
    if (locale !== 'en-US') throw Error()
    return translations
}

test('load resources', async () => {
    const localizer = createLocalizer<Translations>({ load })
    const spy = mock((..._: unknown[]) => {})
    localizer.subscribe(spy)
    expect(spy).toHaveBeenLastCalledWith([], [])
    localizer.setLocales('en-US')
    expect(spy).toHaveBeenLastCalledWith(['en-US'], [])
    localizer.setModules('base')
    expect(spy).toHaveBeenLastCalledWith(['en-US'], ['base'])
    await localizer.wait()
    localizer.setLocales('pt-BR')
    expect(spy).toHaveBeenLastCalledWith(['pt-BR'], ['base'])
    await localizer.wait()
    localizer.unsubscribe(spy)
})

test('translate key', async () => {
    const localizer = createLocalizer<Translations>({ load })
    const { t } = localizer
    localizer.setLocales('en-US')
    localizer.setModules('base')
    await localizer.wait()
    expect(t.base.hi()).toBe('hi')
    expect(t.base.nest.hi()).toBe('hi')
    expect(t.$.other.hi()).toBe('en-US:other.hi')
})

test('resolve tag', async () => {
    const localizer = createLocalizer<Translations, string>({ load })
    const { t } = localizer
    localizer.setLocales('en-US')
    localizer.setModules('base')
    await localizer.wait()
    expect(t.base.tags({}, { a: tags })).toBe('0<a>12</a>3')
    expect(() => t.base.o({}, {})).not.toThrow()
    expect(() => t.base.u({}, {})).not.toThrow()
})
