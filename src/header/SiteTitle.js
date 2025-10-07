import React from 'react'

export function SiteTitle({ title }) {
  return (
    <div className="site-title">
      <h1 className="site-title__heading title-gradient">{title}</h1>
      <div className="site-title__byline">by Anthony Wohlfeil</div>
    </div>
  )
}
