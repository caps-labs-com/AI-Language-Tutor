"use client";

import { parseGrammarFormation } from "@/lib/grammar-format";

export function GrammarFormation({ value }: { value: string }) {
  const blocks = parseGrammarFormation(value);
  return (
    <div className="grammar-formation-content">
      {blocks.map((block, index) => block.type === "paragraph" ? (
        <p key={`paragraph-${index}`}>{block.text}</p>
      ) : (
        <section className="conjugation-card" key={`${block.verb}-${index}`}>
          <header>
            <strong>{block.verb}</strong>
            {block.translation && <span>{block.translation}</span>}
          </header>
          <table>
            <thead><tr><th scope="col">Pessoa</th><th scope="col">Conjugação</th></tr></thead>
            <tbody>{block.rows.map((row, rowIndex) => (
              <tr key={`${row.subject}-${rowIndex}`}>
                <th scope="row">{row.subject}</th>
                <td>{row.form}</td>
              </tr>
            ))}</tbody>
          </table>
        </section>
      ))}
    </div>
  );
}
