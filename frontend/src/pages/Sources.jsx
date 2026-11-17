import React, { useEffect, useMemo, useState } from 'react';
import { createSource, getSources, toggleSource } from '../services/api';
import { CATEGORY_ORDER, categoryClass, categoryLabel, distinctSources } from '../services/categories';
import { toUtcDate } from '../services/dateTime';

const emptyForm = { name: '', url: '', category: 'science' };

const categorySymbols = {
  science: '✦',
  sports: '◒',
  politics: '⚖',
  technology: '⌘',
  world: '◎',
  business: '↗',
  general: '✦',
};

function displayDomain(value) {
  try {
    return new URL(value).hostname.replace(/^www\./, '');
  } catch {
    return value;
  }
}

function relativeUpdate(value) {
  if (!value) return 'Not fetched yet';
  const date = toUtcDate(value);
  if (!date) return 'Recently fetched';
  const minutes = Math.max(0, Math.floor((Date.now() - date.getTime()) / 60000));
  if (minutes < 2) return 'Updated just now';
  if (minutes < 60) return `Updated ${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Updated ${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return `Updated ${days} day${days === 1 ? '' : 's'} ago`;
}

function SourceThumbnail({ category }) {
  const tone = categoryClass(category);
  return (
    <span className={`source-thumbnail category-${tone}`} aria-hidden="true">
      <span>{categorySymbols[tone] || '✦'}</span>
    </span>
  );
}

export default function Sources() {
  const [sources, setSources] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState(emptyForm);
  const [query, setQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [showAddForm, setShowAddForm] = useState(false);

  const load = async () => {
    try {
      setSources(distinctSources(await getSources()));
      setError('');
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleToggle = async (id) => {
    try {
      await toggleSource(id);
      await load();
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    }
  };

  const handleAdd = async (event) => {
    event.preventDefault();
    setError('');
    let url;
    try {
      url = new URL(form.url);
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error();
    } catch {
      setError('Enter a valid http or https RSS URL.');
      return;
    }
    if (sources.some((source) => source.url === url.href)) {
      setError('This feed is already listed.');
      return;
    }
    setSaving(true);
    try {
      await createSource({ name: form.name.trim(), url: url.href, category: form.category });
      setForm(emptyForm);
      setShowAddForm(false);
      await load();
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setSaving(false);
    }
  };

  const visibleSources = useMemo(() => {
    const phrase = query.trim().toLowerCase();
    return sources.filter((source) => {
      const category = categoryLabel(source.category);
      const matchesCategory = selectedCategory === 'All' || category === selectedCategory;
      const matchesQuery = !phrase || [source.name, source.url, category].some((value) => String(value || '').toLowerCase().includes(phrase));
      return matchesCategory && matchesQuery;
    });
  }, [query, selectedCategory, sources]);

  if (loading) return <p>Loading sources…</p>;

  return (
    <div className="sources-page source-library-page">
      <header className="page-heading source-library-heading">
        <div>
          <p className="eyebrow">SOURCE DIRECTORY</p>
          <h1>RSS Source Library</h1>
          <p className="muted">Curate and manage the RSS feeds that power your news briefs.</p>
        </div>
      </header>

      <div className="source-library-toolbar">
        <label className="source-search" aria-label="Search sources">
          <span aria-hidden="true">⌕</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search sources…" />
        </label>
        <nav className="source-filter-list" aria-label="Filter sources by category">
          {['All', ...CATEGORY_ORDER].map((category) => (
            <button
              type="button"
              key={category}
              className={`source-filter ${selectedCategory === category ? 'selected' : ''}`}
              aria-pressed={selectedCategory === category}
              onClick={() => setSelectedCategory(category)}
            >
              {category}
            </button>
          ))}
        </nav>
        <span className="source-count">{visibleSources.length} {visibleSources.length === 1 ? 'source' : 'sources'}</span>
        <button type="button" className="source-add-button" onClick={() => setShowAddForm((show) => !show)} aria-expanded={showAddForm}>
          <span aria-hidden="true">＋</span> Add Source
        </button>
      </div>

      {error && <div className="card source-error" role="alert">{error}</div>}

      {showAddForm && (
        <section className="card source-add-card" aria-labelledby="add-source-title">
          <div><p className="eyebrow">NEW FEED</p><h2 id="add-source-title">Add an RSS source</h2></div>
          <form className="source-form" onSubmit={handleAdd}>
            <input aria-label="Feed name" placeholder="Feed name" required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
            <input aria-label="RSS URL" placeholder="https://example.com/rss" required type="url" value={form.url} onChange={(event) => setForm({ ...form, url: event.target.value })} />
            <select aria-label="Category" value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })}>
              {CATEGORY_ORDER.map((category) => <option key={category} value={category.toLowerCase()}>{category}</option>)}
            </select>
            <button type="submit" disabled={saving}>{saving ? 'Adding…' : 'Save source'}</button>
          </form>
        </section>
      )}

      {visibleSources.length ? (
        <section className="source-grid" aria-label="RSS sources">
          {visibleSources.map((source) => {
            const category = categoryLabel(source.category);
            const tone = categoryClass(source.category);
            return (
              <article key={source.id} className={`source-card category-${tone}`}>
                <SourceThumbnail category={source.category} />
                <div className="source-card-copy">
                  <h2>{source.name}</h2>
                  <p className="source-domain">{displayDomain(source.url)}</p>
                  <div className="source-card-meta">
                    <span className={`source-category-tag category-${tone}`}>{category}</span>
                    <span aria-hidden="true">•</span>
                    <span>{relativeUpdate(source.last_fetched_at)}</span>
                  </div>
                </div>
                <button
                  type="button"
                  className={`source-switch ${source.is_active ? 'on' : ''}`}
                  aria-label={`${source.is_active ? 'Disable' : 'Enable'} ${source.name}`}
                  aria-pressed={source.is_active}
                  onClick={() => handleToggle(source.id)}
                >
                  <span aria-hidden="true" />
                  <em>{source.is_active ? 'On' : 'Off'}</em>
                </button>
              </article>
            );
          })}
        </section>
      ) : (
        <div className="card source-empty"><strong>No sources found.</strong><span>Try a different category or search phrase.</span></div>
      )}
    </div>
  );
}
