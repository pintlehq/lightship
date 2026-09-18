import {
  closeSearchPanel,
  findNext,
  findPrevious,
  getSearchQuery,
  replaceAll,
  replaceNext,
  search,
  SearchQuery,
  setSearchQuery
} from '@codemirror/search'
import { runScopeHandlers, type EditorView, type Panel } from '@codemirror/view'

function makeButton(label: string, text: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'cm-lightship-search-button'
  button.setAttribute('aria-label', label)
  button.title = label
  button.textContent = text
  button.addEventListener('click', onClick)
  return button
}

function createSearchPanel(view: EditorView): Panel {
  const dom = document.createElement('div')
  dom.className = 'cm-lightship-search'
  dom.setAttribute('role', 'search')
  dom.setAttribute('aria-label', 'Find in editor')

  const findRow = document.createElement('div')
  findRow.className = 'cm-lightship-search-row'
  const findLabel = document.createElement('span')
  findLabel.className = 'cm-lightship-search-label'
  findLabel.textContent = 'Find'
  const findInput = document.createElement('input')
  findInput.className = 'cm-lightship-search-input'
  findInput.type = 'text'
  findInput.placeholder = 'Find in editor'
  findInput.setAttribute('aria-label', 'Find in editor')
  findInput.setAttribute('main-field', 'true')
  const count = document.createElement('span')
  count.className = 'cm-lightship-search-count'
  count.setAttribute('role', 'status')
  count.setAttribute('aria-live', 'polite')

  const previous = makeButton('Previous match', '↑', () => findPrevious(view))
  const next = makeButton('Next match', '↓', () => findNext(view))
  const caseButton = makeButton('Match case', 'Aa', () => toggle(caseButton))
  const wordButton = makeButton('Whole word', 'W', () => toggle(wordButton))
  const regexButton = makeButton('Regular expression', '.*', () => toggle(regexButton))
  const replaceToggle = makeButton('Toggle replace', 'Replace', () => {
    replaceRow.hidden = !replaceRow.hidden
    replaceToggle.setAttribute('aria-expanded', String(!replaceRow.hidden))
    if (!replaceRow.hidden) replaceInput.focus()
  })
  replaceToggle.classList.add('cm-lightship-search-replace-toggle')
  replaceToggle.setAttribute('aria-expanded', 'false')
  const close = makeButton('Close search', '×', () => closeSearchPanel(view))
  close.classList.add('cm-lightship-search-close')

  findRow.append(
    findLabel,
    findInput,
    count,
    previous,
    next,
    caseButton,
    wordButton,
    regexButton,
    replaceToggle,
    close
  )

  const replaceRow = document.createElement('div')
  replaceRow.className = 'cm-lightship-search-row cm-lightship-search-replace-row'
  replaceRow.hidden = true
  const replaceLabel = document.createElement('span')
  replaceLabel.className = 'cm-lightship-search-label'
  replaceLabel.textContent = 'Replace'
  const replaceInput = document.createElement('input')
  replaceInput.className = 'cm-lightship-search-input'
  replaceInput.type = 'text'
  replaceInput.placeholder = 'Replace with'
  replaceInput.setAttribute('aria-label', 'Replace with')
  const replaceOne = makeButton('Replace current match', 'Replace', () => replaceNext(view))
  const replaceEvery = makeButton('Replace all matches', 'Replace all', () => replaceAll(view))
  replaceRow.append(replaceLabel, replaceInput, replaceOne, replaceEvery)
  dom.append(findRow, replaceRow)

  let query = getSearchQuery(view.state)

  function syncFields(): void {
    findInput.value = query.search
    replaceInput.value = query.replace
    caseButton.setAttribute('aria-pressed', String(query.caseSensitive))
    wordButton.setAttribute('aria-pressed', String(query.wholeWord))
    regexButton.setAttribute('aria-pressed', String(query.regexp))
  }

  function updateCount(): void {
    const state = view.state
    const current = state.selection.main
    let total = 0
    let active = 0
    if (query.valid) {
      const cursor = query.getCursor(state)
      for (let match = cursor.next(); !match.done; match = cursor.next()) {
        total++
        if (match.value.from === current.from && match.value.to === current.to) active = total
      }
    }
    const invalidRegex = query.search.length > 0 && query.regexp && !query.valid
    const canReplace =
      total > 0 && !state.readOnly && view.contentDOM.getAttribute('contenteditable') !== 'false'
    count.textContent = invalidRegex ? 'Invalid regex' : `${active} / ${total}`
    findInput.setAttribute('aria-invalid', String(invalidRegex))
    previous.disabled = total === 0
    next.disabled = total === 0
    replaceOne.disabled = !canReplace
    replaceEvery.disabled = !canReplace
  }

  function commit(): void {
    const nextQuery = new SearchQuery({
      search: findInput.value,
      replace: replaceInput.value,
      caseSensitive: caseButton.getAttribute('aria-pressed') === 'true',
      wholeWord: wordButton.getAttribute('aria-pressed') === 'true',
      regexp: regexButton.getAttribute('aria-pressed') === 'true'
    })
    if (!nextQuery.eq(query)) {
      query = nextQuery
      view.dispatch({ effects: setSearchQuery.of(nextQuery) })
      updateCount()
    }
  }

  function toggle(button: HTMLButtonElement): void {
    button.setAttribute('aria-pressed', String(button.getAttribute('aria-pressed') !== 'true'))
    commit()
  }

  findInput.addEventListener('input', commit)
  replaceInput.addEventListener('input', commit)
  dom.addEventListener('keydown', (event) => {
    if (runScopeHandlers(view, event, 'search-panel')) {
      event.preventDefault()
    } else if (event.key === 'Enter' && event.target === findInput) {
      event.preventDefault()
      if (event.shiftKey) findPrevious(view)
      else findNext(view)
    } else if (event.key === 'Enter' && event.target === replaceInput) {
      event.preventDefault()
      replaceNext(view)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      closeSearchPanel(view)
    }
  })

  syncFields()
  updateCount()

  return {
    dom,
    top: true,
    mount: () => {
      findInput.focus()
      findInput.select()
    },
    update: () => {
      const nextQuery = getSearchQuery(view.state)
      if (!nextQuery.eq(query)) {
        query = nextQuery
        syncFields()
      }
      updateCount()
    }
  }
}

/** Lightship's inline CodeMirror search bar, shared by YAML and data editors. */
export const lightshipSearch = search({ top: true, createPanel: createSearchPanel })
