# haxforge — plano

Editor de mapas visual e moderno para o HaxBall: criar do zero ou importar um `.hbs` e editar, com ferramentas que nenhum editor tem hoje (letreiro, gerador paramétrico, simetria ao vivo, playground com a física real).

## Base técnica

- **Web estático**: Vite + Bun + TypeScript + Preact, publicado no **GitHub Pages**.
- **Kickr vendorizado** (cópia em `src/vendor/kickr/`, commit de origem anotado em `src/vendor/kickr/VENDOR.md`): parser/compilador de estádio, física (bit a bit igual ao HaxBall), regras de jogo, renderer Clássico em Canvas 2D e `ClientSim` (extrapolação).
- **Render**: Canvas 2D, visual **Clássico do HaxBall** (sem a skin Kickr). Camadas do editor por cima: objetos `vis:false` tracejados/esmaecidos (ocultáveis), alças, seleção, overlays.
- **Idioma**: UI em pt-BR fixa (sem camada de i18n). Código, comentários e commits em inglês.

## Documento e arquivo

- **Round-trip lossless**: parser JSON5 próprio que guarda a sintaxe concreta (comentários, espaços, aspas, vírgulas sobrando). O que não foi editado sai byte a byte idêntico; o que é novo ou editado imita o estilo detectado no arquivo (minificado, um objeto por linha, JSON indentado; tipo de aspas; indentação; quebra de linha). Mapa do zero usa um objeto por linha.
- Comentários de índice (`/* 12 */`) são renumerados quando a ordem muda.
- **Metadados** do editor numa chave `"haxforge"` na raiz do `.hbs` (HaxBall e kickr ignoram). "Exportar limpo" remove a chave.
- **Traits com herança visível**: o inspector mostra a origem de cada valor (objeto / trait / padrão do HaxBall); editar sobrescreve no objeto; "resetar", "aplicar ao trait", painel de traits com contagem de uso e "extrair trait" da seleção.
- **Camadas = ordem real dos arrays** (é a ordem de desenho do HaxBall). Reordenar/apagar remapeia sozinho `v0/v1` dos segmentos e `d0/d1` dos joints (considerando o deslocamento da bola quando `ballPhysics` não é `"disc0"`).
- **Limite de 255** por tipo: medidor sempre visível, custo antes de aplicar, otimizador (compartilhar vértices, segmentos curvos no lugar de polilinhas, Douglas-Peucker, slider qualidade × custo) e exportação bloqueada acima do limite.

## Edição

- Layout estilo Figma: ferramentas à esquerda, camadas abaixo, canvas infinito no centro, inspector à direita, orçamento e ações no topo. Paleta de comandos `Ctrl+K`, atalhos de uma tecla, tema escuro.
- Precisão: grid configurável, ímã em vértices, pontos médios e interseções, `Shift` trava ângulo em 15°, guias de alinhamento, cotas ao vivo (comprimento/ângulo), entrada numérica durante o desenho e no inspector.
- **Overlays de física**: direção do bias, normais dos planes, cores por cMask/cGroup, parede "inflada" pelo raio do jogador.
- **Linter** ao vivo: vãos por onde bola/jogador escapam (com o raio real), spawn dentro de parede, goal fora do campo, segmento de comprimento zero, curva inválida, índices inválidos, mais de 255, cMask que não colide com nada, objeto fora da área visível. Quick-fix quando possível.
- Autosave em IndexedDB com vários projetos, undo/redo ilimitado, histórico de versões (snapshots), link compartilhável com o mapa comprimido no hash da URL, import por arquivo, arrastar e soltar ou colar texto.

## Objetos inteligentes (reeditáveis; podem ser "explodidos" em primitivas)

- **Letreiro**: texto → segmentos. Fontes de traço único embutidas (estilo Hershey) e qualquer TTF/OTF via opentype.js (curvas viram segmentos curvos). Decorativo por padrão (cMask vazio), "sólido" opcional.
- **Gerador paramétrico**: Classic/Big, Futsal, Real Soccer, Hockey/arena, tudo por sliders.
- **Simetria ao vivo** em X, Y ou ambos: o espelho inverte o sinal de `curve` e o lado do `bias`, troca red↔blue em goals e spawns; cópias vinculadas.
- **Importar SVG/imagem** → segmentos decorativos com simplificação.
- **Pincéis e padrões**: grama listrada, xadrez, arco de pontos, grade, repetir objeto ao longo de um caminho.

## Playground (local, sem servidor)

- Sala loopback no navegador rodando o `game.ts` do kickr com o `ClientSim` real na frente: `/extrapolation` e `/lag` funcionam de verdade.
- Controle de tempo: pausa, frame a frame, câmera lenta, rewind (física determinística + snapshots).
- Lançador de bola: arrastar para lançar, com trajetória prevista.
- Modo split: editor e jogo lado a lado, geometria recarregada ao vivo.

## Fases

1. ✅ **Núcleo**: modelo lossless, import/export, canvas com seleção/desenho/snap, inspector com traits, camadas, undo, autosave, medidor de 255.
2. ✅ **Jogar**: playground local (`/extrapolation`, `/lag`, tempo, lançador), split ao vivo, linter, overlays de física.
3. ✅ **Inteligentes**: letreiro, gerador paramétrico, simetria ao vivo, otimizador.
4. ✅ **Criação**: SVG/imagem, pincéis e padrões, fontes TTF, link compartilhável, histórico de versões.
5. ✅ **WebMCP**: o editor expõe ferramentas para agentes de IA no navegador (`document.modelContext.registerTool`, com fallback para o antigo `navigator.modelContext`). Um agente consegue ler o mapa e os problemas do linter, criar e editar objetos, gerar campo e letreiro, espelhar, otimizar, simular chutes com a física real e exportar. Toda edição de agente passa pelo histórico (Ctrl+Z desfaz) e aparece num registro de atividade; dá para desligar.

## Riscos

- Detectar vãos com segmentos curvos e o raio inflado do jogador (linter) é a parte geométrica mais difícil.
- Fontes de contorno custam muitos objetos: o slider qualidade × custo é obrigatório.
- A cópia do kickr não recebe correções sozinha: atualizar a partir do commit anotado em `VENDOR.md`.
- WebMCP ainda é rascunho de Community Group: o nome do objeto (`document.modelContext` × `navigator.modelContext`) e o formato do retorno mudaram durante 2026; o registro detecta os dois e precisa de revisão quando o padrão firmar.
