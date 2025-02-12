// src/SuggestionForm.js
import React, { useState } from 'react';

const SuggestionForm = () => {
  const [name, setName] = useState('');
  const [location, setLocation] = useState('');
  const [message, setMessage] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    console.log("Submit button clicked!"); // Debugging log
  
    const formData = { name, location, message };
    console.log("Form Data:", formData); // Check what is being sent
  
    const response = await fetch("https://formsubmit.co/anthonywohlfeil@gmail.com", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(formData),
    });
  
    console.log("Response status:", response.status); // Log response
  
    if (response.ok) {
      setSubmitted(true);
      setName("");
      setLocation("");
      setMessage("");
    } else {
      alert("Error sending submission.");
    }
  };

  return (
<div className="sidebar-container suggestion-form">
    <h2>Recommendations?</h2>
      {submitted ? (
        <p>Thanks for the recommendation! 🍕</p>
      ) : (
        <form onSubmit={handleSubmit}>
          <label>
            Your Name:
            <input value={name} onChange={(e) => setName(e.target.value)} required />
          </label>
          <br></br>
          <label>
            Location:
            <input value={location} onChange={(e) => setLocation(e.target.value)} required />
          </label>
          <br></br>
          <label>
            What should I order?
            <textarea value={message} onChange={(e) => setMessage(e.target.value)} required />
          </label>
          <button type="submit">Submit Suggestion</button>
        </form>
      )}
    </div>
  );
};

export default SuggestionForm;