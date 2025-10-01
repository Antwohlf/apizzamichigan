const mockDataByTable = {}

const mockFrom = jest.fn((table) => {
  return {
    select: jest.fn(() => ({
      order: jest.fn(() => Promise.resolve({
        data: mockDataByTable[table] || [],
        error: null,
      })),
    })),
  }
})

module.exports = {
  supabase: {
    from: (...args) => mockFrom(...args),
  },
  __mockFrom: mockFrom,
  __setMockTable: (table, rows) => {
    mockDataByTable[table] = rows
  },
  __resetMockData: () => {
    Object.keys(mockDataByTable).forEach((key) => delete mockDataByTable[key])
  },
}
