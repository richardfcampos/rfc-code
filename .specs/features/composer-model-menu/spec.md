# Composer Model Menu Specification

## Problem Statement

Hoje só dá pra escolher o modelo em dois momentos: na tela vazia de sessão nova (`ProviderSelectionEmptyState`) ou digitando `/models`. Numa sessão já em andamento não existe controle visível — a barra do composer mostra apenas o chip de permission mode e o de effort. O upstream v1.37.0 resolveu com um `ComposerModelMenu` que junta modelo + effort num único menu; o fork parou na v1.36.3.

## Goals

- [ ] Trocar de modelo a qualquer momento, direto na barra do composer
- [ ] Um único menu para modelo **e** effort (AD-017), substituindo o chip "Effort Default" atual
- [ ] Reaproveitar o estado que já existe (`useChatProviderState`) — nenhuma fonte de verdade nova

## Out of Scope

| Feature | Motivo |
| --- | --- |
| Chip separado só de modelo | AD-017: menu combinado, igual upstream — menos poluição no mobile |
| Mudar a persistência de modelo | `localStorage` por provider já funciona (`claude-model`, `codex-model`, …) |
| Remover `/models` ou o seletor da tela vazia | Continuam válidos; o menu é um caminho adicional |

---

## User Stories

### P1: Trocar de modelo pelo composer ⭐ MVP

**User Story**: Como usuário, quero um botão na barra do composer que abra um menu de modelos, para trocar sem sair da sessão.

**Acceptance Criteria**:

1. WHEN o usuário clica no botão de modelo THEN o sistema SHALL abrir um menu com a seção Modelo (catálogo do provider ativo) e a seção Effort (valores aceitos pelo modelo selecionado)
2. WHEN o usuário escolhe um modelo THEN o sistema SHALL persistir via `selectProviderModel` do `useChatProviderState` e fechar o menu
3. WHEN o modelo escolhido não aceita o effort atual THEN o sistema SHALL normalizar para um valor permitido (regra que já existe em `getAllowedEffortValues`)
4. WHEN o catálogo do provider está vazio ou carregando THEN o menu SHALL esconder a seção ou mostrar "Loading models…", sem quebrar
5. WHEN o provider ativo não expõe effort THEN a seção de Effort SHALL sumir, e só a de Modelo aparece
6. WHEN o menu abre perto da borda da tela THEN o sistema SHALL reposicionar via portal para não estourar o viewport

**Independent Test**: numa sessão com mensagens, abrir o menu, trocar de modelo e confirmar que a próxima mensagem sai no modelo novo e que o valor sobrevive a um reload.

---

## Edge Cases

- WHEN não há provider selecionado THEN o botão SHALL ficar oculto/desabilitado junto com o resto da barra
- WHEN o modelo salvo no `localStorage` sumiu do catálogo THEN o sistema SHALL cair no default do provider (comportamento atual de `pickStoredOrCurrent`, preservado)

---

## Requirement Traceability

| Requirement ID | Story | Fase | Status |
| --- | --- | --- | --- |
| MODEL-01 | P1: menu combinado modelo+effort | Execute | Pending |
| MODEL-02 | P1: seleção persistida via estado existente | Execute | Pending |
| MODEL-03 | P1: seções vazias/carregando/sem-effort | Execute | Pending |
| MODEL-04 | P1: posicionamento por portal | Execute | Pending |

---

## Execute Checklist (Medium — sem tasks.md formal)

1. Portar `useComposerMenuAnchor.ts` (82 ln) e `ComposerMenuPrimitives.tsx` (94 ln) do upstream — sem alteração
2. Portar `ComposerModelMenu.tsx` (168 ln)
3. Trocar o bloco do dropdown de effort no `ChatComposer.tsx` pelo `<ComposerModelMenu>`; adicionar props `model` / `availableModelOptions` / `onSelectModel` / `modelsLoading`
4. Passar as props novas em `ChatInterface.tsx` a partir do que `useChatProviderState` já devolve
5. Adicionar as chaves de i18n (`input.model`, `input.effortDefault`, `input.loadingModels`, `input.modelMenu`, `input.permissionHeading`) em en + 8 locales

## Success Criteria

- [ ] Modelo trocável em sessão ativa, em desktop e tablet
- [ ] Nenhuma regressão no chip de permission mode nem no envio de mensagem
- [ ] Build EXIT 0, lint limpo, suíte verde
