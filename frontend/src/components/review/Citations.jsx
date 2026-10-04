import { useState } from 'react';
import { useVersion } from '../../api/hooks.js';
import { formatCitation } from '../../utils/format.js';
import { Badge } from '../Badge.jsx';
import { InlineError, Spinner } from '../StatusViews.jsx';

/** Highlights the first fragment of the quote found in the section text (best effort, display only). */
export function highlightQuote(text, quote) {
  const fragment = quote.split(/\.{3}|…/)[0].trim();
  const index = fragment ? text.toLowerCase().indexOf(fragment.toLowerCase()) : -1;
  if (index === -1) return [text];
  return [text.slice(0, index), <mark key="q">{text.slice(index, index + fragment.length)}</mark>, text.slice(index + fragment.length)];
}

function SourceSection({ versionId, citation }) {
  const version = useVersion(versionId);
  if (version.isPending) return <Spinner label="Loading source" />;
  if (version.isError) return <InlineError error={version.error} />;
  const section = version.data.documents.flatMap((d) => d.sections).find((s) => s.id === citation.sectionId);
  if (!section) return <p className="muted small">The cited section could not be found in the stored document.</p>;
  return (
    <div className="source-section">
      <p className="muted small">
        Source: {citation.documentRole} {formatCitation(citation)}
        {section.heading ? ` — ${section.heading}` : ''}
      </p>
      <pre className="source-section__text">{highlightQuote(section.text, citation.quote)}</pre>
    </div>
  );
}

export function Citations({ item }) {
  const [open, setOpen] = useState(null);
  return (
    <ul className="citations">
      {item.citations.map((citation) => (
        <li key={citation.id} className="citation">
          <div className="citation__head">
            <strong>{formatCitation(citation)}</strong>
            {citation.verified ? (
              <Badge value="confirmed" title="Quote found verbatim in the cited section">
                Quote verified
              </Badge>
            ) : (
              <Badge value="unverified" title="The quote could not be found in the document text" />
            )}
            {citation.sectionId && (
              <button
                type="button"
                className="link-button"
                aria-expanded={open === citation.id}
                onClick={() => setOpen(open === citation.id ? null : citation.id)}
              >
                {open === citation.id ? 'Hide source' : 'Show source'}
              </button>
            )}
          </div>
          <blockquote className="citation__quote">“{citation.quote}”</blockquote>
          {open === citation.id && <SourceSection versionId={item.contractVersionId} citation={citation} />}
        </li>
      ))}
    </ul>
  );
}
