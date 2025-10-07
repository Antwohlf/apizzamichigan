import React from 'react'

export function SiteTitle({ title }) {
  return (
    <div className="site-title">
      <h1 className="site-title__heading title-gradient">{title}</h1>
      <div className="site-title__byline">
        by{' '}
        <a
          href="https://www.linkedin.com/in/anthony-wohlfeil/"
          target="_blank"
          rel="noopener noreferrer"
          className="site-title__link"
        >
          Anthony Wohlfeil
        </a>
      </div>
    </div>
  )
}
