import { NavLink, Outlet } from 'react-router';

export function DisclaimerBanner() {
  return (
    <div className="disclaimer" role="note">
      <strong>Information-management tool — not legal advice.</strong> AI-extracted items may be wrong or incomplete.
      Only human-approved items feed reminders and summaries. Always rely on the signed contract.
    </div>
  );
}

export function Layout() {
  return (
    <div className="app">
      <header className="header">
        <NavLink to="/" className="brand">
          Contract Obligation Assistant
        </NavLink>
        <nav className="nav" aria-label="Main">
          <NavLink to="/" end>
            Dashboard
          </NavLink>
          <NavLink to="/contracts" end>
            Contracts
          </NavLink>
          <NavLink to="/contracts/new" className="nav__cta">
            Upload contract
          </NavLink>
        </nav>
      </header>
      <DisclaimerBanner />
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
