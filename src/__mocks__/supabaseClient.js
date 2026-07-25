const mockDataByTable = {}

const createQuery = (table) => {
  const state = {
    count: null,
    head: false,
    stateFilter: null,
    statusFilter: null,
    ratingRequired: false,
    rangeStart: null,
    rangeEnd: null,
    limit: null,
    minimumRating: null,
  }

  const result = () => {
    let data = [...(mockDataByTable[table] || [])]
    if (state.stateFilter) {
      data = data.filter(row => state.stateFilter.includes(row.state))
    }
    if (state.statusFilter) {
      data = data.filter(row => state.statusFilter.includes(row.status))
    }
    if (state.ratingRequired) {
      data = data.filter(row => row.rating !== null && row.rating !== undefined)
    }
    if (state.minimumRating !== null) {
      data = data.filter(row => Number(row.rating) >= state.minimumRating)
    }
    if (state.rangeStart !== null && state.rangeEnd !== null) {
      data = data.slice(state.rangeStart, state.rangeEnd + 1)
    }
    if (state.limit !== null) {
      data = data.slice(0, state.limit)
    }
    return Promise.resolve({
      data: state.head ? null : data,
      count: state.count ? data.length : null,
      error: null,
    })
  }

  const query = {
    select: jest.fn((columns, options = {}) => {
      state.count = options.count || null
      state.head = Boolean(options.head)
      return query
    }),
    order: jest.fn(() => query),
    range: jest.fn((start, end) => {
      state.rangeStart = start
      state.rangeEnd = end
      return query
    }),
    limit: jest.fn(limit => {
      state.limit = limit
      return query
    }),
    ilike: jest.fn(() => query),
    in: jest.fn((column, values) => {
      if (column === 'state') state.stateFilter = values
      if (column === 'status') state.statusFilter = values
      return query
    }),
    not: jest.fn((column, operator) => {
      if (column === 'rating' && operator === 'is') state.ratingRequired = true
      return query
    }),
    gte: jest.fn((column, value) => {
      if (column === 'rating') state.minimumRating = Number(value)
      return query
    }),
    or: jest.fn(() => query),
    then: (resolve, reject) => result().then(resolve, reject),
    catch: reject => result().catch(reject),
    finally: callback => result().finally(callback),
  }

  return query
}

const mockFrom = jest.fn()
const supabaseFrom = (...args) => {
  mockFrom(...args)
  return createQuery(...args)
}

module.exports = {
  supabase: {
    from: supabaseFrom,
  },
  __mockFrom: mockFrom,
  __setMockTable: (table, rows) => {
    mockDataByTable[table] = rows
  },
  __resetMockData: () => {
    Object.keys(mockDataByTable).forEach((key) => delete mockDataByTable[key])
  },
}
