import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import AdminConfirmDialog from './AdminConfirmDialog'

describe('AdminConfirmDialog', () => {
  test('focuses the confirm action and supports keyboard cancellation', () => {
    const onCancel = jest.fn()
    render(
      <AdminConfirmDialog
        open
        title="Confirm action"
        message={'A line of detail.\nA second line.'}
        onConfirm={jest.fn()}
        onCancel={onCancel}
      />
    )

    expect(screen.getByRole('dialog', { name: 'Confirm action' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Continue' })).toHaveFocus()
    expect(screen.getByText(/A second line/)).toBeInTheDocument()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  test('calls the requested action buttons', () => {
    const onConfirm = jest.fn()
    const onCancel = jest.fn()
    render(<AdminConfirmDialog open title="Confirm action" message="Details" onConfirm={onConfirm} onCancel={onCancel} />)

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})
