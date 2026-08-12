# Guia de UI/UX — Price 3D

Diretrizes do visual moderno do frontend. O objetivo é uma aparência de
**SaaS limpo e atual** (superfícies de vidro, sombras suaves, realces em
gradiente índigo→violeta) mantendo **toda a lógica e as telas existentes
intactas** — a modernização vive na camada compartilhada
(`tailwind.config.js`, `index.css`, `components/ui.tsx`, `components/Layout.tsx`).

## Shell e tema

- **Sidebar** (`Layout.tsx`): navegação fixa à esquerda no desktop, com grupos
  (Operação / Cadastros / Ajustes) e ícones (`components/icons.tsx`, SVG inline);
  vira drawer no mobile. Topbar com título da página, seletor de moeda e o
  **toggle de tema**.
- **Tema claro/escuro** (`lib/theme.tsx`): Tailwind `darkMode: 'class'`. A classe
  `dark` é aplicada no `<html>` antes do React montar (script em `index.html`,
  evita "flash"), persistida em `localStorage` e com fallback à preferência do SO.
  Componentes de `ui.tsx` já trazem variantes `dark:`; use os componentes
  compartilhados para herdar o tema automaticamente.

## Princípios

1. **Não comprometer o que já existe.** Nenhuma regra de negócio, rota, chamada
   de API ou estrutura de página foi alterada. Só apresentação.
2. **Consistência via camada compartilhada.** Botões, inputs, cards e o layout
   são reutilizados por todas as telas — mudar o token propaga para todas.
3. **Sutileza.** Gradientes e sombras como acento, nunca como ruído.

## Tokens de design (`tailwind.config.js`)

| Token | Valor | Uso |
|-------|-------|-----|
| `brand.50…900` | rampa índigo (`#6366f1` base) | marca, foco, links, estados ativos |
| `accent.400…600` | violeta (`#8b5cf6`) | segunda parada dos gradientes |
| `bg-brand-gradient` | `linear-gradient(135deg,#6366f1,#7c3aed)` | botão primário, marca, nav ativa |
| `shadow-soft` | sombra difusa leve | cards, inputs |
| `shadow-lift` | elevação no hover | cards ao passar o mouse |
| `shadow-glow` | sombra colorida da marca | botão primário, logo |
| `font-sans` | Inter → system-ui | tipografia geral |
| `animate-fade-in` | fade + sobe 6px | entrada de páginas e cards |

## Utilitários (`index.css`)

- **Fundo da página:** claro (`#f4f5fb`) com dois brilhos radiais de marca fixos
  nos cantos.
- `.glass` — superfície de vidro (`bg-white/70` + `backdrop-blur`) para header e
  destaques.
- `.text-gradient` — texto preenchido com o gradiente da marca (usado no "3D").
- `.card-hover` — elevação + leve subida no hover.

## Componentes (`components/ui.tsx`)

- **Button** `primario` = gradiente + `shadow-glow`; `secundario` = vidro claro;
  `perigo` = vermelho. Cantos `rounded-xl`, micro-interação `active:scale`.
- **Input/Select** — `rounded-xl`, fundo translúcido, anel de foco suave da marca.
- **Card** — `rounded-2xl`, vidro sutil, `shadow-soft`.
- **StatTile** — barra de acento em gradiente no topo, número em destaque.
- **Alerta** — mantido (info/erro/sucesso/aviso).

## Como evoluir

- Precisa de uma nova cor? Adicione uma **shade** na rampa `brand`/`accent`, não
  um hex solto na tela.
- Novo componente reutilizável entra em `ui.tsx` para herdar os tokens.
- Evite estilos inline exceto para valores dinâmicos (ex.: cor de acento vinda
  de dados).
