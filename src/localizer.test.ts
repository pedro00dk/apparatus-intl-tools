import assert from 'node:assert/strict'
import { mock, test } from 'node:test'
import { createLocalizer } from './localizer.ts'

const translations = { hi: 'hi', 'nest.hi': '<:hi/>', icu: '{hi}', tags: '0<a>1<b/>2</a>3', u: '<a><b>', o: '</a></b>' }
type Translations = { base: typeof translations }

const tags = (children: string[], tag: string) => `<${tag}>${children.join('')}</${tag}>`
const load = (locale: string) => {
    if (locale !== 'en-US') throw Error()
    return translations
}

test('load resources', async () => {
    const localizer = createLocalizer<Translations>({ load })
    const spy = mock.fn()
    localizer.subscribe(spy)
    assert.deepEqual(spy.mock.calls.at(-1)?.arguments, [[], []])
    localizer.setLocales('en-US')
    assert.deepEqual(spy.mock.calls.at(-1)?.arguments, [['en-US'], []])
    localizer.setModules('base')
    assert.deepEqual(spy.mock.calls.at(-1)?.arguments, [['en-US'], ['base']])
    await localizer.wait()
    localizer.setLocales('pt-BR')
    assert.deepEqual(spy.mock.calls.at(-1)?.arguments, [['pt-BR'], ['base']])
    await localizer.wait()
    localizer.unsubscribe(spy)
})

test('translate key', async () => {
    const localizer = createLocalizer<Translations>({ load })
    const { proxy: t } = localizer
    localizer.setLocales('en-US')
    localizer.setModules('base')
    await localizer.wait()
    assert(t.base.hi(), 'hi')
    assert(t.base.nest.hi(), 'hi')
    assert(t.base.icu(), 'en-US:base:icu')
    assert(t.other.hi.$(), 'en-US:other:hi')
})

test('resolve tag', async () => {
    const localizer = createLocalizer<Translations>({ load })
    const { proxy: t, tagger: tag } = localizer
    localizer.setLocales('en-US')
    localizer.setModules('base')
    await localizer.wait()
    assert(tag(t.base.tags(), { a: tags }), '<>0<a>1<b></b>2</a>3</>')
    assert.doesNotThrow(() => tag(t.base.o(), {}))
    assert.doesNotThrow(() => tag(t.base.u(), {}))
})
