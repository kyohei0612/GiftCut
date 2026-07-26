import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles.css'

class ErrBoundary extends React.Component<
  { children: React.ReactNode },
  { err: Error | null }
> {
  state = { err: null as Error | null }
  static getDerivedStateFromError(err: Error): { err: Error } {
    return { err }
  }
  render(): React.ReactNode {
    if (this.state.err)
      return (
        <pre
          id="errbox"
          style={{ color: '#f88', background: '#111', padding: 16, whiteSpace: 'pre-wrap', fontSize: 12 }}
        >
          {String(this.state.err?.message)}
          {'\n\n'}
          {String(this.state.err?.stack)}
        </pre>
      )
    return this.props.children
  }
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <ErrBoundary>
      <App />
    </ErrBoundary>
  </React.StrictMode>
)
