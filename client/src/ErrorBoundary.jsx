import React from 'react';

// Évite l'écran blanc : une page qui plante affiche un message au lieu de faire disparaître toute l'application.
export default class ErrorBoundary extends React.Component {
  state = { error: null };
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error) { console.error(error); }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="card" style={{ margin: 24, padding: 24 }}>
        <h2 style={{ marginTop: 0 }}>Cette page n'a pas pu s'afficher</h2>
        <p>Une erreur inattendue s'est produite. Le reste de l'application reste utilisable.</p>
        <button className="btn" onClick={() => this.setState({ error: null })}>Réessayer</button>{' '}
        <a className="btn" href="/">Tableau de bord</a>
      </div>
    );
  }
}
