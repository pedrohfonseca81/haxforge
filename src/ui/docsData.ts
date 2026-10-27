export interface DocCategory {
  id: string;
  title: { pt: string; en: string };
  icon: string;
}

export interface DocSection {
  heading?: { pt: string; en: string };
  text?: { pt: string; en: string };
  items?: Array<{
    term: { pt: string; en: string };
    desc: { pt: string; en: string };
  }>;
  table?: {
    headers: { pt: string[]; en: string[] };
    rows: Array<{ pt: string[]; en: string[] }>;
  };
  callout?: {
    type: "tip" | "info" | "warning";
    title?: { pt: string; en: string };
    text: { pt: string; en: string };
  };
  code?: {
    language: string;
    code: string;
  };
}

export interface DocArticle {
  id: string;
  category: string;
  title: { pt: string; en: string };
  badge: { pt: string; en: string };
  summary: { pt: string; en: string };
  media?: {
    type: "image" | "video";
    src: string | { pt: string; en: string };
    caption: { pt: string; en: string };
  };
  sections: DocSection[];
}

export const DOC_CATEGORIES: DocCategory[] = [
  { id: "start", title: { pt: "Início & Primeiros Passos", en: "Getting Started" }, icon: "Compass" },
  { id: "controls", title: { pt: "Canvas & Atalhos", en: "Canvas & Shortcuts" }, icon: "Keyboard" },
  { id: "physics", title: { pt: "Primitivas & Física", en: "Primitives & Physics" }, icon: "Atom" },
  { id: "smart", title: { pt: "Objetos Inteligentes", en: "Smart Objects" }, icon: "Sparkles" },
  { id: "advanced", title: { pt: "Ferramentas Avançadas", en: "Advanced Tools" }, icon: "Wrench" },
  { id: "projects", title: { pt: "Projetos & Compartilhamento", en: "Projects & Sharing" }, icon: "Share2" },
];

export const DOC_ARTICLES: DocArticle[] = [
  // 1. OVERVIEW
  {
    id: "overview",
    category: "start",
    title: { pt: "Visão Geral & Filosofia", en: "Overview & Philosophy" },
    badge: { pt: "Essencial", en: "Essential" },
    summary: {
      pt: "O haxforge é um editor de mapas moderno, rápido e sem backend para o HaxBall, focado em precisão matemática, preservação fiel do formato e produtividade máxima.",
      en: "haxforge is a modern, fast, zero-backend map editor for HaxBall, designed with mathematical precision, lossless format preservation, and maximum workflow productivity.",
    },
    media: {
      type: "image",
      src: {
        pt: "./docs/media/pt/home.webp",
        en: "./docs/media/en/home.webp",
      },
      caption: {
        pt: "Tela inicial do haxforge: acesso rápido a projetos locais e modelos oficiais do HaxBall.",
        en: "haxforge home screen: instant access to browser-saved projects and official HaxBall templates.",
      },
    },
    sections: [
      {
        heading: { pt: "O que é o haxforge?", en: "What is haxforge?" },
        text: {
          pt: "O haxforge foi construído para resolver os problemas históricos dos editores de HaxBall: interfaces lentas, perda de formatação e comentários em arquivos .hbs, curvas imprecisas e necessidade de softwares externos para tarefas simples como letreiros ou campos simétricos.",
          en: "haxforge was built to fix long-standing frustrations with HaxBall map editors: sluggish UIs, formatting corruption, stripped comments in .hbs files, imprecise curves, and the need for external tools for simple tasks like banners or symmetrical fields.",
        },
      },
      {
        heading: { pt: "Principais Diferenciais", en: "Key Highlights" },
        items: [
          {
            term: { pt: "Zero Backend & 100% Local", en: "Zero Backend & 100% Client-Side" },
            desc: {
              pt: "Todos os seus mapas são salvos no IndexedDB do navegador. Nada é enviado para servidores externos sem o seu consentimento explícito.",
              en: "All maps are persisted directly in browser IndexedDB. No external servers or logins required.",
            },
          },
          {
            term: { pt: "Round-trip JSON5 sem perdas", en: "Lossless JSON5 Round-tripping" },
            desc: {
              pt: "O analisador preserva a ordem exata das chaves, comentários e números originais do arquivo .hbs ao editar propriedades específicas.",
              en: "The parser retains key order, syntax comments, and unchanged numbers byte-for-byte upon export.",
            },
          },
          {
            term: { pt: "Física Real Integrada", en: "Integrated Real Physics Engine" },
            desc: {
              pt: "Simulação de física HaxBall idêntica ao jogo oficial rodando no próprio navegador com atalho Ctrl+Enter.",
              en: "Identical HaxBall physics engine simulated directly in the tab, playable with Ctrl+Enter.",
            },
          },
        ],
      },
    ],
  },

  // 2. QUICKSTART
  {
    id: "quickstart",
    category: "start",
    title: { pt: "Primeiros Passos", en: "Quickstart Guide" },
    badge: { pt: "Guia", en: "Guide" },
    summary: {
      pt: "Aprenda como iniciar um projeto em branco, abrir um mapa existente ou gerar um campo completo em poucos cliques.",
      en: "Learn how to start a blank stadium, import an existing file, or generate a full pitch in seconds.",
    },
    media: {
      type: "image",
      src: {
        pt: "./docs/media/pt/editor-overview.webp",
        en: "./docs/media/en/editor-overview.webp",
      },
      caption: {
        pt: "Editor com o mapa Classic carregado: ferramentas à esquerda, canvas ao centro e painel de propriedades à direita.",
        en: "Editor with the Classic stadium: tools on the left, canvas in the center, properties inspector on the right.",
      },
    },
    sections: [
      {
        heading: { pt: "Como iniciar um novo mapa", en: "Starting a New Map" },
        text: {
          pt: "Na tela inicial, você tem 4 maneiras de começar a trabalhar:",
          en: "From the home screen, you have 4 quick ways to get started:",
        },
        items: [
          {
            term: { pt: "Novo mapa", en: "New map" },
            desc: { pt: "Cria um estádio vazio com configurações padrão prontas.", en: "Creates an empty stadium with sensible defaults." },
          },
          {
            term: { pt: "Gerar campo", en: "Generate field" },
            desc: { pt: "Cria um campo completo e paramétrico (linhas, traves, redes e áreas).", en: "Creates a complete parametric field with lines, posts, nets, and boxes." },
          },
          {
            term: { pt: "Abrir .hbs ou Colar texto", en: "Open .hbs or Paste text" },
            desc: { pt: "Importa qualquer arquivo .hbs, JSON ou JSON5 do seu disco ou área de transferência.", en: "Imports any .hbs, JSON, or JSON5 file from disk or clipboard." },
          },
          {
            term: { pt: "Modelos Oficiais", en: "Official Templates" },
            desc: { pt: "Clique em Classic, Big, Futsal, Hockey, Rounded ou Huge para carregar imediatamente.", en: "Click Classic, Big, Futsal, Hockey, Rounded, or Huge to clone and start editing." },
          },
        ],
      },
      {
        callout: {
          type: "tip",
          title: { pt: "Arrastar e Soltar", en: "Drag & Drop" },
          text: {
            pt: "Você pode soltar arquivos .hbs diretamente em qualquer parte da janela para abri-los como um novo projeto.",
            en: "You can drag and drop .hbs files anywhere onto the window to open them as a new project.",
          },
        },
      },
    ],
  },

  // 3. CANVAS & CONTROLS
  {
    id: "canvas-controls",
    category: "controls",
    title: { pt: "Navegação & Atalhos", en: "Canvas Navigation & Shortcuts" },
    badge: { pt: "Produtividade", en: "Productivity" },
    summary: {
      pt: "Domine os controles de zoom, panorâmica, seleção e os atalhos de teclado para acelerar seu fluxo de trabalho.",
      en: "Master pan, zoom, precision selection, and essential keyboard shortcuts for ultra-fast stadium crafting.",
    },
    media: {
      type: "image",
      src: {
        pt: "./docs/media/pt/command-palette.webp",
        en: "./docs/media/en/command-palette.webp",
      },
      caption: {
        pt: "Paleta de comandos (Ctrl+K): pesquise qualquer ação, ferramenta ou configuração instantaneamente.",
        en: "Command palette (Ctrl+K): search any action, tool, or setting instantly without leaving the keyboard.",
      },
    },
    sections: [
      {
        heading: { pt: "Navegação do Canvas", en: "Canvas Navigation" },
        table: {
          headers: {
            pt: ["Ação", "Mouse / Teclado", "Descrição"],
            en: ["Action", "Mouse / Keyboard", "Description"],
          },
          rows: [
            {
              pt: ["Mover vista (Pan)", "Botão do meio OU Espaço + Arrastar", "Desloca o campo sem alterar elementos"],
              en: ["Pan View", "Middle Click OR Space + Drag", "Moves the viewport without moving elements"],
            },
            {
              pt: ["Zoom", "Roda do mouse OU Pinça no trackpad", "Aproxima ou afasta com foco na posição do cursor"],
              en: ["Zoom", "Mouse Wheel OR Trackpad Pinch", "Zooms in/out centered at cursor coordinates"],
            },
            {
              pt: ["Ajustar à tela", "Shift + 1", "Centraliza e enquadra o estádio inteiro na tela"],
              en: ["Fit to Screen", "Shift + 1", "Centers and fits the entire stadium in view"],
            },
            {
              pt: ["Zoom 100%", "Shift + 0", "Restaura o zoom padrão de 1:1"],
              en: ["Reset Zoom (1:1)", "Shift + 0", "Restores the default 1:1 scale"],
            },
          ],
        },
      },
      {
        heading: { pt: "Atalhos de Ferramentas", en: "Tool Shortcuts" },
        table: {
          headers: {
            pt: ["Tecla", "Ferramenta", "Função"],
            en: ["Key", "Tool", "Function"],
          },
          rows: [
            { pt: ["V", "Seleção", "Seleciona, move e curva segmentos através do manipulador em losango"], en: ["V", "Select", "Selects, drags, and bends segments via the diamond handle"] },
            { pt: ["A", "Vértice", "Cria vértices soltos clicando no canvas"], en: ["A", "Vertex", "Creates freestanding vertices by clicking on the canvas"] },
            { pt: ["S", "Segmento", "Cria linhas encadeadas. Esc finaliza a cadeia"], en: ["S", "Segment", "Chains continuous line segments. Esc finishes chain"] },
            { pt: ["D", "Disco", "Cria discos físicos. Arraste para definir o raio"], en: ["D", "Disc", "Creates physics discs. Drag to set radius"] },
            { pt: ["G", "Gol", "Cria traves e linha de gol entre dois postes"], en: ["G", "Goal", "Creates posts and goal detection lines"] },
            { pt: ["P", "Plano", "Cria planos de colisão infinitos ao longo da borda"], en: ["P", "Plane", "Creates infinite bounding plane colliders"] },
            { pt: ["J", "Junta (Joint)", "Liga dois discos com uma mola de distância"], en: ["J", "Joint", "Connects two physics discs with a distance spring"] },
            { pt: ["T", "Letreiro", "Insere texto vetorial inteligente no campo"], en: ["T", "Smart Text", "Places smart vector banner text onto the pitch"] },
            { pt: ["M", "Régua", "Mede distâncias e ângulos no canvas"], en: ["M", "Ruler", "Measures distance and angles on the canvas"] },
          ],
        },
      },
      {
        heading: { pt: "Comandos Rápidos", en: "Quick Commands" },
        table: {
          headers: {
            pt: ["Atalho", "Comando"],
            en: ["Shortcut", "Command"],
          },
          rows: [
            { pt: ["Ctrl + K", "Abre a Paleta de Comandos"], en: ["Ctrl + K", "Open Command Palette"] },
            { pt: ["Ctrl + Enter", "Testa o mapa no Simulador (Tela cheia)"], en: ["Ctrl + Enter", "Test map in Physics Simulator (Fullscreen)"] },
            { pt: ["Ctrl + Shift + Enter", "Abre o Simulador lado a lado com o Editor"], en: ["Ctrl + Shift + Enter", "Open Simulator side-by-side with live sync"] },
            { pt: ["Ctrl + Z / Ctrl + Shift + Z", "Desfazer / Refazer"], en: ["Ctrl + Z / Ctrl + Shift + Z", "Undo / Redo"] },
            { pt: ["Ctrl + D", "Duplica os elementos selecionados"], en: ["Ctrl + D", "Duplicate selected elements"] },
            { pt: ["Delete / Backspace", "Apaga os elementos selecionados"], en: ["Delete / Backspace", "Delete selected elements"] },
          ],
        },
      },
    ],
  },

  // 4. PRIMITIVES & PHYSICS
  {
    id: "primitives",
    category: "physics",
    title: { pt: "Vértices, Segmentos & Curvas", en: "Vertices, Segments & Curves" },
    badge: { pt: "Física", en: "Physics" },
    summary: {
      pt: "Entenda a geometria base do HaxBall: como segmentos, curvaturas (curve), bias e máscaras de colisão funcionam na prática.",
      en: "Understand the core geometry of HaxBall: how segments, curves (-180° to 180°), bias, and collision masks interact.",
    },
    media: {
      type: "image",
      src: {
        pt: "./docs/media/pt/physics-overlay.webp",
        en: "./docs/media/en/physics-overlay.webp",
      },
      caption: {
        pt: "Visualização com overlay de física: cores representam as camadas de colisão e o bias exibe a espessura física real.",
        en: "Physics overlay enabled: wall colors illustrate collision layers and bias outlines show actual collision volume.",
      },
    },
    sections: [
      {
        heading: { pt: "Vértices", en: "Vertices" },
        text: {
          pt: "Vértices são pontos no plano 2D com coordenadas (x, y). O centro do campo é sempre (0, 0). No HaxBall, vértices também podem possuir colisão própria (bCoef e cMask), prevenindo que a bola escape pelas junções.",
          en: "Vertices are points on the 2D plane with (x, y) coordinates. The origin (0, 0) is the pitch center. In HaxBall, vertices can also carry collision (bCoef and cMask) to prevent balls slipping through corners.",
        },
      },
      {
        heading: { pt: "Segmentos & O Parâmetro Curve", en: "Segments & The Curve Parameter" },
        text: {
          pt: "Um segmento liga dois vértices (v0 e v1). Quando reto, `curve = 0`. Quando curvado, o valor representa o ângulo do arco em graus, variando de -180 a 180. Valores positivos curvam o arco para a esquerda da direção do segmento; valores negativos curvam para a direita.",
          en: "A segment joins two vertices (v0 and v1). Straight lines have `curve = 0`. For arcs, the value represents the angle in degrees from -180 to 180. Positive values curve to the left of the travel direction; negative values curve to the right.",
        },
      },
      {
        heading: { pt: "Máscaras e Grupos de Colisão (cGroup & cMask)", en: "Collision Masks & Groups (cGroup & cMask)" },
        items: [
          {
            term: { pt: "cGroup (Quem eu sou)", en: "cGroup (Who I am)" },
            desc: { pt: "Identifica a qual grupo o elemento pertence (ex: 'wall', 'ball', 'red', 'blue').", en: "Defines the collision group of this element (e.g. 'wall', 'ball', 'red', 'blue')." },
          },
          {
            term: { pt: "cMask (Com quem eu colido)", en: "cMask (Who I collide with)" },
            desc: { pt: "Lista com quais grupos haverá colisão física. Se `cMask: []`, a linha é puramente visual (decorativa).", en: "Specifies which groups cause physics collisions. If `cMask: []`, the element is purely decorative." },
          },
          {
            term: { pt: "bCoef (Elasticidade/Bounce)", en: "bCoef (Restitution/Bounce)" },
            desc: { pt: "Coeficiente de quique. 1.0 mantém a velocidade; maior que 1.0 acelera o quique; 0.0 anula o rebote.", en: "Bounce coefficient. 1.0 preserves velocity; >1.0 accelerates rebounds; 0.0 absorbs energy." },
          },
          {
            term: { pt: "Bias (Espessura e Sentido)", en: "Bias (Thickness & Direction)" },
            desc: { pt: "Desloca o plano de colisão sem mover a linha visual, evitando que a bola atravesse quinas em alta velocidade.", en: "Offsets collision boundary from visual segment to prevent ball clipping at extreme speeds." },
          },
        ],
      },
    ],
  },

  // 5. DISCS, GOALS, PLANES & JOINTS
  {
    id: "discs-goals-planes",
    category: "physics",
    title: { pt: "Discos, Gols, Planos & Juntas", en: "Discs, Goals, Planes & Joints" },
    badge: { pt: "Primitivas", en: "Primitives" },
    summary: {
      pt: "Guia completo sobre os corpos dinâmicos (discos), zonas de gol, planos delimitadores e juntas elásticas.",
      en: "Comprehensive guide to dynamic physics bodies (discs), goal scoring zones, infinite bounding planes, and spring joints.",
    },
    media: {
      type: "image",
      src: {
        pt: "./docs/media/pt/traits-panel.webp",
        en: "./docs/media/en/traits-panel.webp",
      },
      caption: {
        pt: "Aba Traits: crie e gerencie estilos reutilizáveis para aplicar as mesmas cores e físicas em múltiplos elementos.",
        en: "Traits tab: create and manage reusable presets for consistent styles and physics across multiple objects.",
      },
    },
    sections: [
      {
        heading: { pt: "Discos (Discs)", en: "Discs" },
        text: {
          pt: "Discos são círculos de colisão com posição (pos), raio (radius), amortecimento (damping) e massa inversa (invMass).",
          en: "Discs are collision circles with position (pos), radius, air drag (damping), and inverse mass (invMass).",
        },
        items: [
          {
            term: { pt: "invMass = 0 (Estático)", en: "invMass = 0 (Static)" },
            desc: { pt: "O disco possui massa infinita e permanece fixo no espaço (ex: traves e postes).", en: "Infinite mass; the disc remains completely immovable (e.g. goal posts)." },
          },
          {
            term: { pt: "invMass > 0 (Dinâmico)", en: "invMass > 0 (Dynamic)" },
            desc: { pt: "O disco é móvel e reage a impulsos, gravidade e colisões com jogadores e a bola.", en: "Movable physics body reacting to impacts, velocity, and collisions." },
          },
        ],
      },
      {
        heading: { pt: "Gols (Goals)", en: "Goals" },
        text: {
          pt: "Um gol define a linha de contagem de pontos entre dois postes (p0 e p1) e o time que pontua ('red' ou 'blue'). Quando o centro da bola cruza essa linha no sentido correto, o gol é registrado.",
          en: "A goal defines the scoring detection segment between posts (p0 and p1) and target team ('red' or 'blue'). When the ball center crosses this segment, a goal is registered.",
        },
      },
      {
        heading: { pt: "Planos (Planes)", en: "Planes" },
        text: {
          pt: "Planos são semi-espaços de colisão infinitos definidos por um vetor normal `normal: [dx, dy]` e uma distância `dist`. São usados principalmente para as quatro paredes externas do estádio.",
          en: "Planes are infinite collision half-spaces defined by a normal vector `normal: [dx, dy]` and a scalar `dist`. Primarily used for outer stadium bounds.",
        },
      },
      {
        heading: { pt: "Juntas (Joints)", en: "Joints" },
        text: {
          pt: "Juntas conectam dois discos (ou um disco e um ponto fixo) através de uma restrição de distância com elasticidade ajustável (`strength`). Permite criar redes elásticas, pêndulos e barreiras mecânicas.",
          en: "Joints link two physics discs (or a disc and anchor) with a distance constraint and tunable stiffness (`strength`). Great for springy nets, pendulums, and dynamic obstacles.",
        },
      },
    ],
  },

  // 6. BUDGET LIMITS
  {
    id: "budget",
    category: "physics",
    title: { pt: "Orçamento & Limites do HaxBall", en: "Budget & HaxBall Limits" },
    badge: { pt: "Atenção", en: "Warning" },
    summary: {
      pt: "O HaxBall possui um limite estrito de 255 itens por categoria. Entenda como o haxforge monitora e impede que seu mapa trave.",
      en: "HaxBall strictly enforces a 255-item limit per primitive category. Learn how haxforge tracks budget to guarantee compatibility.",
    },
    sections: [
      {
        heading: { pt: "O Limite de 255 Itens", en: "The 255 Limit" },
        text: {
          pt: "O motor original do HaxBall indexa entidades usando números inteiros de 8 bits. Isso significa que NENHUM mapa pode ultrapassar 255 em nenhuma destas categorias:",
          en: "The original HaxBall game engine indexes entities using 8-bit integers. As a result, NO stadium may exceed 255 of any single category:",
        },
        items: [
          { term: { pt: "Vértices", en: "Vertexes" }, desc: { pt: "Máximo 255", en: "Max 255" } },
          { term: { pt: "Segmentos", en: "Segments" }, desc: { pt: "Máximo 255", en: "Max 255" } },
          { term: { pt: "Discos", en: "Discs" }, desc: { pt: "Máximo 255", en: "Max 255" } },
          { term: { pt: "Gols", en: "Goals" }, desc: { pt: "Máximo 255", en: "Max 255" } },
          { term: { pt: "Planos", en: "Planes" }, desc: { pt: "Máximo 255", en: "Max 255" } },
          { term: { pt: "Juntas", en: "Joints" }, desc: { pt: "Máximo 255", en: "Max 255" } },
        ],
      },
      {
        callout: {
          type: "warning",
          title: { pt: "O que acontece se passar de 255?", en: "What happens if 255 is exceeded?" },
          text: {
            pt: "Se você tentar carregar um mapa com 256 vértices no HaxBall oficial, a sala irá falhar ou congelar. A barra de orçamento no topo do haxforge fica amarela em 85% e vermelha em 255 para alertar você antes de exportar.",
            en: "Attempting to load a stadium with 256 vertices into official HaxBall will crash the room. The topbar meters turn yellow at 85% and red at 255 to keep your maps safe.",
          },
        },
      },
    ],
  },

  // 7. FIELD GENERATOR
  {
    id: "field-generator",
    category: "smart",
    title: { pt: "Gerador de Campo Inteligente", en: "Parametric Field Generator" },
    badge: { pt: "Smart Object", en: "Smart Object" },
    summary: {
      pt: "Crie campos de futebol, futsal e hockey profissionais em segundos e ajuste dimensões dinamicamente.",
      en: "Generate regulation football, futsal, and hockey pitches in seconds, with full parametric live adjustment.",
    },
    media: {
      type: "image",
      src: {
        pt: "./docs/media/pt/field-generator.webp",
        en: "./docs/media/en/field-generator.webp",
      },
      caption: {
        pt: "Gerador de Campo: alterne modelos (Classic, Big, Futsal, Real) e altere medidas mantendo todas as proporções.",
        en: "Field Generator: switch templates (Classic, Big, Futsal, Real) and tweak dimensions with automatic geometric recalculation.",
      },
    },
    sections: [
      {
        heading: { pt: "Como funciona?", en: "How It Works" },
        text: {
          pt: "Em vez de desenhar manualmente dezenas de retas e arcos para as quatro linhas laterais, pequena área, grande área, círculo central e gols, o Gerador de Campo cria uma estrutura paramétrica que você pode modificar a qualquer instante pelo painel de Propriedades.",
          en: "Instead of manually drawing dozens of segments for touchlines, penalty boxes, center circles, and goals, the Field Generator creates a procedural smart object that you can modify at any time in the Inspector.",
        },
      },
      {
        heading: { pt: "Parâmetros Disponíveis", en: "Available Parameters" },
        items: [
          { term: { pt: "template", en: "template" }, desc: { pt: "Classic, Big, Futsal, Real, Hockey ou Custom.", en: "Classic, Big, Futsal, Real, Hockey, or Custom." } },
          { term: { pt: "width & height", en: "width & height" }, desc: { pt: "Metades do comprimento e largura da cancha de jogo.", en: "Half-width and half-height of the playable pitch." } },
          { term: { pt: "goal & depth", en: "goal & depth" }, desc: { pt: "Abertura da trave e profundidade da rede.", en: "Goalmouth half-width and net depth." } },
          { term: { pt: "corner", en: "corner" }, desc: { pt: "Raio de curvatura das quinas do campo.", en: "Corner arc radius." } },
          { term: { pt: "net", en: "net" }, desc: { pt: "Estilo da rede: 'curve' (arredondada) ou 'box' (quadrada).", en: "Net style: 'curve' (rounded) or 'box' (rectangular)." } },
          { term: { pt: "area", en: "area" }, desc: { pt: "Marcações de área: 'none', 'futsal' (arco semicircular) ou 'real' (grande e pequena área).", en: "Box markings: 'none', 'futsal' (semicircle arc), or 'real' (penalty & six-yard boxes)." } },
        ],
      },
    ],
  },

  // 8. SMART TEXT
  {
    id: "smart-text",
    category: "smart",
    title: { pt: "Letreiros & Fonte Haxforge Sans", en: "Smart Text & Haxforge Sans" },
    badge: { pt: "Inovação", en: "Innovation" },
    summary: {
      pt: "Escreva qualquer texto no mapa usando a fonte nativa Haxforge Sans (feita de retas e arcos) ou mais de 30 fontes de traço.",
      en: "Add beautiful pitch banners using the built-in Haxforge Sans font (native arcs and lines) or 30+ single-stroke fonts.",
    },
    media: {
      type: "image",
      src: {
        pt: "./docs/media/pt/smart-text.webp",
        en: "./docs/media/en/smart-text.webp",
      },
      caption: {
        pt: "Letreiro Inteligente: configure texto, tamanho, ângulo de rotação, curvatura em arco (bend) e modos de colisão.",
        en: "Smart Text: configure banner text, size, rotation angle, arc bend, and collision modes in real time.",
      },
    },
    sections: [
      {
        heading: { pt: "O Problema dos Letreiros Tradicionais", en: "The Traditional Text Problem" },
        text: {
          pt: "Fontes convertidas em polígonos gastam centenas de vértices: uma única letra 'O' em outros editores costuma consumir entre 16 e 32 segmentos, estourando rapidamente o limite de 255 do HaxBall.",
          en: "Traditional text imports waste hundreds of vertices: a single letter 'O' usually eats 16 to 32 segments, rapidly exceeding HaxBall's 255-segment budget.",
        },
      },
      {
        heading: { pt: "A Solução: Haxforge Sans", en: "The Solution: Haxforge Sans" },
        text: {
          pt: "Criamos a fonte proprietária Haxforge Sans. Ela utiliza os arcos nativos do HaxBall: um 'O' perfeito é desenhado com apenas 4 vértices e 4 segmentos, permanecendo 100% suave em qualquer nível de zoom!",
          en: "We created the proprietary Haxforge Sans stroke font. It leverages native HaxBall arc primitives: a flawless 'O' costs only 4 vertices and 4 segments, staying crisp and smooth at any zoom level!",
        },
      },
      {
        heading: { pt: "Recursos do Letreiro", en: "Banner Features" },
        items: [
          { term: { pt: "Curvatura (Bend)", en: "Arc Curvature (Bend)" }, desc: { pt: "Curva o texto ao longo de um arco em graus (ótimo para círculos centrais e arquibancadas).", en: "Curves text along an arc in degrees (ideal for center circles and stands)." } },
          { term: { pt: "Colisão Sólida vs Decorativa", en: "Solid vs Decorative" }, desc: { pt: "Escolha se as letras bloqueiam a bola ('ball', 'all') ou são apenas visuais ('none').", en: "Choose whether letters bounce the ball ('ball', 'all') or are purely decorative ('none')." } },
          { term: { pt: "30+ Fontes de Traço", en: "30+ Stroke Fonts" }, desc: { pt: "Inclui famílias Hershey (Simplex, Duplex, Complex, Triplex, Script, Gothic).", en: "Includes Hershey font families (Simplex, Duplex, Complex, Triplex, Script, Gothic)." } },
        ],
      },
    ],
  },

  // 9. SYMMETRY & PATTERNS
  {
    id: "symmetry-patterns",
    category: "smart",
    title: { pt: "Simetria, Espelhamento & Padrões", en: "Symmetry, Mirroring & Patterns" },
    badge: { pt: "Smart Object", en: "Smart Object" },
    summary: {
      pt: "Trabalhe na metade do campo e deixe o haxforge espelhar o restante automaticamente com fidelidade matemática.",
      en: "Design one half of the stadium and let haxforge mirror the other half automatically with mathematical precision.",
    },
    sections: [
      {
        heading: { pt: "Simetria Inteligente", en: "Smart Symmetry" },
        text: {
          pt: "Campos de HaxBall são inerentemente simétricos. Com a Simetria do haxforge, você desenha traves, áreas e decorações no lado esquerdo (ou superior), e o lado oposto é espelhado em tempo real. Edições na matriz propagam instantaneamente para as cópias.",
          en: "HaxBall fields are inherently symmetric. With haxforge Symmetry, you create goals, boxes, and decor on one half, and the opposite half mirrors live. Any tweak to the original instantly synchronizes.",
        },
      },
      {
        heading: { pt: "Padrões de Grama & Repetição", en: "Field Patterns & Radial Arrays" },
        items: [
          { term: { pt: "Listras do Gramado", en: "Lawn Mowing Stripes" }, desc: { pt: "Gera automaticamente faixas de grama cortada alternadas no campo.", en: "Generates alternating turf stripes across the pitch." } },
          { term: { pt: "Repetição Circular", en: "Circular Repeat (Radial Array)" }, desc: { pt: "Gira e distribui cópias de um elemento em círculo (ideal para arquibancadas e estádios circulares).", en: "Rotates and replicates elements around a central pivot (ideal for circular arenas and stands)." } },
        ],
      },
    ],
  },

  // 10. VECTOR & IMAGE IMPORT
  {
    id: "vector-import",
    category: "smart",
    title: { pt: "Importação de SVG & Imagens", en: "Vector & Image Tracing" },
    badge: { pt: "Vetorização", en: "Vector Tracing" },
    summary: {
      pt: "Importe logotipos e ilustrações vetoriais ou rasterizadas (PNG, JPEG, WebP) com conversão automática para arcos nativos.",
      en: "Import logos and graphics (SVG, PNG, JPEG, WebP) with automatic conversion to native HaxBall arcs.",
    },
    media: {
      type: "image",
      src: {
        pt: "./docs/media/pt/image-import.webp",
        en: "./docs/media/en/image-import.webp",
      },
      caption: {
        pt: "Caixa de importação de imagem: ajuste limiar de contorno e simplificação de traçado.",
        en: "Image import dialog: tune threshold and curve simplification parameters.",
      },
    },
    sections: [
      {
        heading: { pt: "Como importar?", en: "How to Import?" },
        text: {
          pt: "Basta arrastar um arquivo SVG ou imagem para a janela com o editor aberto, ou acessar 'Importar imagem/SVG' na paleta de comandos (Ctrl+K).",
          en: "Simply drag and drop an SVG or raster image file into the editor window, or pick 'Import image/SVG' from the command palette (Ctrl+K).",
        },
      },
      {
        heading: { pt: "Detecção Inteligente de Círculos", en: "Intelligent Arc Detection" },
        text: {
          pt: "Diferente de traçadores comuns que geram centenas de retas microscópicas, o traçador do haxforge detecta curvaturas circulares e as substitui por arcos nativos de HaxBall com curve em graus, economizando dezenas de segmentos.",
          en: "Unlike generic vectorizers that produce hundreds of micro-segments, haxforge's tracer detects circular paths and replaces them with native arc segments, saving vital budget.",
        },
      },
    ],
  },

  // 11. OPTIMIZER
  {
    id: "optimizer",
    category: "advanced",
    title: { pt: "Otimizador de Geometria", en: "Stadium Mesh Optimizer" },
    badge: { pt: "Economia", en: "Optimization" },
    summary: {
      pt: "Reduza em até 80% os vértices e segmentos do seu mapa com fusão de retas colineares e conversão de polígonos em arcos.",
      en: "Reduce vertices and segments by up to 80% with collinear merging and polygon-to-arc conversion.",
    },
    media: {
      type: "image",
      src: {
        pt: "./docs/media/pt/optimizer.webp",
        en: "./docs/media/en/optimizer.webp",
      },
      caption: {
        pt: "Otimizador: compare antes e depois e visualize a economia exata de segmentos antes de aplicar.",
        en: "Optimizer modal: review before/after stats and verify segment savings before applying.",
      },
    },
    sections: [
      {
        heading: { pt: "O que o Otimizador faz?", en: "What Does the Optimizer Do?" },
        items: [
          {
            term: { pt: "Fusão Colinear", en: "Collinear Merging" },
            desc: { pt: "Junta vértices consecutivos que formam uma linha reta em um único segmento.", en: "Merges consecutive vertices along a straight line into a single segment." },
          },
          {
            term: { pt: "Conversão de Círculos Poligonais", en: "Polygon Circle to Arc Conversion" },
            desc: { pt: "Transforma anéis de 16 ou 32 retas em apenas 4 arcos nativos, economizando dezenas de itens.", en: "Converts 16- or 32-segment polygonal circles into 4 native arcs, saving massive budget." },
          },
          {
            term: { pt: "Limpeza de Linhas Duplicadas", en: "Duplicate & Zero-Length Cleanup" },
            desc: { pt: "Remove segmentos de comprimento zero e linhas sobrepostas indesejadas.", en: "Removes zero-length segments and duplicate overlapping lines." },
          },
        ],
      },
    ],
  },

  // 12. LINTER & AUDIT
  {
    id: "linter",
    category: "advanced",
    title: { pt: "Auditor de Física & Correção de Problemas", en: "Physics Linter & Issue Audit" },
    badge: { pt: "Auditoria", en: "Audit" },
    summary: {
      pt: "Detecte automaticamente vazamentos na rede, frestas onde a bola escapa e spawns dentro de paredes com 1 clique para corrigir.",
      en: "Automatically identify net leaks, ball clipping gaps, and spawns inside walls with one-click quick fixes.",
    },
    media: {
      type: "image",
      src: {
        pt: "./docs/media/pt/issues-panel.webp",
        en: "./docs/media/en/issues-panel.webp",
      },
      caption: {
        pt: "Painel de Problemas: lista avisos e erros em tempo real com botão de correção rápida.",
        en: "Issues panel: displays real-time warnings and errors with one-click automated fixes.",
      },
    },
    sections: [
      {
        heading: { pt: "Verificações Realizadas", en: "Audited Checks" },
        items: [
          {
            term: { pt: "Gols Abertos (Vazamento de Bola)", en: "Open Goals (Net Leaks)" },
            desc: { pt: "Verifica se a bola pode escapar por trás ou pelas laterais da rede após passar a linha de gol.", en: "Checks if the ball can slip out through gaps behind or beside the goal net." },
          },
          {
            term: { pt: "Frestas Menores que a Bola", en: "Narrow Collision Bottlenecks" },
            desc: { pt: "Detecta espaços menores que o diâmetro da bola que causam travamento de física ou atravessamento.", en: "Flags gaps narrower than the ball that cause physics glitching or high-speed tunneling." },
          },
          {
            term: { pt: "Spawns em Paredes", en: "Spawns Inside Walls" },
            desc: { pt: "Avisa se pontos de nascimento do time red ou blue estão presos dentro de colisões sólidas.", en: "Warns if team red or blue player spawn positions are trapped inside solid colliders." },
          },
        ],
      },
    ],
  },

  // 13. PLAYGROUND & LAUNCHER
  {
    id: "playground",
    category: "advanced",
    title: { pt: "Simulador de Física & Lançador de Trajetória", en: "Physics Simulator & Trajectory Launcher" },
    badge: { pt: "Simulação", en: "Simulation" },
    summary: {
      pt: "Teste a jogabilidade do seu mapa em tempo real sem sair da aba, com física 100% fiel e previsão visual de trajetória.",
      en: "Test stadium gameplay in real time directly in the browser, with identical physics and visual trajectory prediction.",
    },
    media: {
      type: "video",
      src: "./docs/media/launcher.mp4",
      caption: {
        pt: "Demonstração do lançador de trajetória: previsão exata de ricochetes na parede e no poste antes do chute.",
        en: "Trajectory launcher showcase: exact deterministic bounce and rebound prediction before the shot.",
      },
    },
    sections: [
      {
        heading: { pt: "Modos de Jogo", en: "Play Modes" },
        items: [
          { term: { pt: "Tela Cheia (Ctrl+Enter)", en: "Fullscreen (Ctrl+Enter)" }, desc: { pt: "Foco total na partida de teste com placar e cronômetro.", en: "Full focus test match with scoreboard and timer." } },
          { term: { pt: "Lado a Lado (Ctrl+Shift+Enter)", en: "Side-by-Side (Ctrl+Shift+Enter)" }, desc: { pt: "O jogo roda ao lado do canvas. Toda modificação no editor recarrega a física instantaneamente.", en: "Plays beside the editor canvas. Every edit reloads physics instantly." } },
          { term: { pt: "2 Jogadores Locais", en: "2 Local Players" }, desc: { pt: "Player 1 (WASD / Espaço) e Player 2 (Setas / NumPad 0) para testar divididas e jogadas.", en: "Player 1 (WASD / Space) and Player 2 (Arrows / Numpad 0) for 1v1 playtesting." } },
        ],
      },
      {
        heading: { pt: "Lançador de Trajetória (Ball Launcher)", en: "Trajectory Launcher" },
        text: {
          pt: "O lançador permite mirar e testar chutes com linha de previsão determinística: mostra exatamente os ângulos de ricochete nas paredes, traves e postes antes mesmo do chute ser disparado.",
          en: "The ball launcher displays an exact deterministic future trajectory line, tracing wall bounces, post deflections, and final velocity before you even strike the ball.",
        },
      },
      {
        heading: { pt: "Controle de Tempo", en: "Time Controls" },
        text: {
          pt: "Pause a qualquer momento, avance quadro a quadro (step) ou retroceda no tempo (rewind) com reprodução 100% determinística para investigar como a bola se comportou em um lance polêmico.",
          en: "Pause at any frame, step one frame at a time, or rewind time with deterministic replay to analyze close rebounds and goalmouth interactions.",
        },
      },
    ],
  },

  // 14. WEBMCP & AI
  {
    id: "webmcp",
    category: "advanced",
    title: { pt: "Integração com IA via WebMCP", en: "AI Assistants via WebMCP" },
    badge: { pt: "IA / MCP", en: "AI / MCP" },
    summary: {
      pt: "Conecte assistentes de inteligência artificial (Claude Desktop, Cursor, Antigravity) para criar e alterar mapas por linguagem natural.",
      en: "Connect AI assistants (Claude, Cursor, Antigravity) to create and refine stadiums using conversational instructions.",
    },
    sections: [
      {
        heading: { pt: "O que é o WebMCP?", en: "What is WebMCP?" },
        text: {
          pt: "O WebMCP expõe as ferramentas do editor haxforge através do protocolo padrão Model Context Protocol (MCP). Isso permite que agentes externos controlem o mapa em tempo real.",
          en: "WebMCP exposes haxforge tools via the standard Model Context Protocol (MCP). This enables external AI agents to manipulate stadiums in real time.",
        },
      },
      {
        heading: { pt: "Ferramentas Disponíveis para o Agente", en: "Exposed Agent Tools" },
        items: [
          { term: { pt: "create_field", en: "create_field" }, desc: { pt: "Gera ou redimensiona campos completos com medidas oficiais.", en: "Generates or scales regulation pitches." } },
          { term: { pt: "write_text", en: "write_text" }, desc: { pt: "Escreve letreiros com curvatura e fonte Haxforge Sans.", en: "Adds curved banner text in Haxforge Sans." } },
          { term: { pt: "simulate_shot", en: "simulate_shot" }, desc: { pt: "Dispara simulações de chutes e relata se houve gol ou defesa.", en: "Executes test shots and returns goal or save outcomes." } },
          { term: { pt: "get_issues", en: "get_issues" }, desc: { pt: "Verifica e retorna a lista de problemas de física do mapa.", en: "Audits and returns active physics issues." } },
        ],
      },
    ],
  },

  // 15. VERSIONS & SHARING
  {
    id: "versions-sharing",
    category: "projects",
    title: { pt: "Versões, Salvamento & Compartilhamento", en: "Versions, Autosave & Sharing" },
    badge: { pt: "Segurança", en: "Safety" },
    summary: {
      pt: "Histórico completo com pontos de restauração no navegador, links instantâneos para amigos e exportação limpa de arquivos .hbs.",
      en: "Complete local version history with checkpoints, instant one-click share links, and clean .hbs exports.",
    },
    sections: [
      {
        heading: { pt: "Salvamento Automático & Versões", en: "Autosave & Named Snapshots" },
        text: {
          pt: "Cada alteração é salva instantaneamente no IndexedDB do seu navegador. Além disso, pelo botão de Histórico (ícone de relógio no topo), você pode criar versões nomeadas ('Antes da final', 'Teste traves') e restaurar qualquer ponto do passado com 1 clique.",
          en: "Every edit is auto-saved to IndexedDB. In addition, the History dialog (clock icon in the topbar) lets you take named snapshots and roll back to any earlier state instantly.",
        },
      },
      {
        heading: { pt: "Links de Compartilhamento (#map=...)", en: "Share Links (#map=...)" },
        text: {
          pt: "Ao clicar em 'Copiar link do mapa', o haxforge compacta o arquivo inteiro com compressão deflate e gera uma URL curta. Qualquer amigo que abrir o link tem o mapa clonado no navegador dele na hora, sem precisar de cadastro.",
          en: "Clicking 'Copy map link' compresses the entire stadium with deflate encoding into a short URL. Anyone who opens the link gets an instant clone in their browser with zero sign-ups.",
        },
      },
      {
        heading: { pt: "Opções de Exportação", en: "Export Options" },
        items: [
          { term: { pt: "Baixar .hbs", en: "Download .hbs" }, desc: { pt: "Gera o arquivo padrão legível mantendo metadados inteligentes.", en: "Downloads standard legible .hbs preserving smart object metadata." } },
          { term: { pt: "Baixar limpo (Clean)", en: "Download Clean" }, desc: { pt: "Remove chaves proprietárias do haxforge, ideal para servidores dedicados de HaxBall.", en: "Strips haxforge editor metadata for pure vanilla HaxBall server deployment." } },
          { term: { pt: "Copiar texto", en: "Copy text" }, desc: { pt: "Copia o código .hbs para a área de transferência.", en: "Copies the .hbs raw text directly to your clipboard." } },
        ],
      },
    ],
  },
];
