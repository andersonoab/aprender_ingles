# Lousa da Fluência
- **Usar no Chrome** Usar apenas no Chrome.
- **No Celular, usar somente no Android** No Celular, usar somente no Android.

Uma aplicação web para praticar construção de frases em inglês por meio de drag & drop, com reprodução de áudio e exportação de histórico em PDF.

---

## 🚀 Funcionalidades

- **Importar** arquivo `.txt` com pares de frases no formato `English|Português`.
- **Drag & drop** das palavras para montar a frase em inglês.
- **Feedback visual**: mostra frase original em EN/PT ao acertar.
- **Áudio automático**: ao completar corretamente ou ao avançar para a próxima frase, toca a frase em inglês.
- **Histórico** de acertos/erros, sempre atualizado com a contagem total.
- **Exportar PDF** do histórico de frases com jsPDF.

---

## 📦 Tecnologias

- **HTML5** & **CSS3** (Flexbox, variáveis CSS)
- **JavaScript ES6+**  
- **[jsPDF](https://github.com/parallax/jsPDF)** para geração de PDF  
- **[Artyom.js](https://sdkcarlos.github.io/sites/artyom.html)** para Text-to-Speech  

---

## 🛠️ Instalação & Uso

1. **Clone** o repositório  
   ```bash
   git clone https://github.com/seu-usuario/lousa-da-fluencia.git
   ```
2. **Abra** `index.html` diretamente no navegador (não precisa de servidor).
3. **Clique** em **Escolher arquivo ❔** e selecione seu `.txt`:
   ```
   I’d love to learn more about payroll.|Eu adoraria saber mais sobre folha de pagamento.
   ```
4. **Arraste** as palavras para os slots até formar a frase.
5. Ao acertar, verá **EN/PT** e o áudio será tocado automaticamente.
6. Clique em **Próxima Frase ⏭️** para avançar (e ouvir o áudio).
7. A qualquer momento, exporte seu histórico em PDF clicando em **Salvar Histórico em PDF**.

---

## 🗂️ Estrutura

```
/
├── index.html
├── README.md
├── css/
│   └── (ou manter inline para protótipo)
└── js/
    ├── app.js          # lógica de drag/drop, áudio e PDF
    └── artyom.window.min.js
```

---

## ✨ Personalização

- Separe CSS e JS em arquivos externos (`css/`, `js/`) para organizar melhor.
- Ajuste variações de cor e fontes em `:root` no CSS.
- Implemente mais controles (pausar/repetir áudio, dicas adicionais, etc.).

---

## 📄 Licença

GNU 2.1 © 2025 Igarapé Digital
