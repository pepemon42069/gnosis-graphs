export function StorageSettings() {
  return (
    <section className="settings-group">
      <h3 className="ui-section-label pixel-label">Snapshots</h3>
      <p className="settings-hint">
        The server writes timestamped workspace snapshots to its filesystem — every few
        minutes while there are changes, and immediately after a cascade deletion. Use
        Data → Export for an on-demand bundle copy.
      </p>
    </section>
  )
}
