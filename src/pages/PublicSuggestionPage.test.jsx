import { render, screen } from '@testing-library/react'
import PublicSuggestionPage from './PublicSuggestionPage'

describe('PublicSuggestionPage', () => {
  test.each([
    ['pizza', 'A Pizza Michigan', 'What should I order?'],
    ['taco', 'TacoBoutMichigan', 'What should I try?'],
  ])('renders an unauthenticated %s suggestion form', (entity, brand, recommendationLabel) => {
    render(<PublicSuggestionPage entity={entity} />)

    expect(screen.getByText(brand)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Back to the map/i })).toHaveAttribute(
      'href',
      entity === 'pizza' ? '/' : '/tacos',
    )
    expect(screen.getByRole('heading', { name: 'Suggest a place' })).toBeInTheDocument()
    expect(screen.getByLabelText('Your Name')).toBeInTheDocument()
    expect(screen.getByLabelText('Location')).toBeInTheDocument()
    expect(screen.getByLabelText(recommendationLabel)).toBeInTheDocument()
    expect(screen.queryByText(/admin/i)).not.toBeInTheDocument()
  })
})
