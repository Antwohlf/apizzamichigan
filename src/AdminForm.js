import React, { useState } from "react";
import { supabase } from "./supabaseClient"; // Ensure Supabase is properly set up

const AdminForm = () => {
  const [authed, setAuthed] = useState(false);
  const [passwordInput, setPasswordInput] = useState("");
  const [name, setName] = useState("");
  const [style, setStyle] = useState("");
  const [price, setPrice] = useState("$");
  const [address, setAddress] = useState("");
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [review, setReview] = useState("");
  const [rating, setRating] = useState("");

  const ADMIN_PASS = "mypizza123";

  const handlePasswordSubmit = () => {
    if (passwordInput === ADMIN_PASS) {
      setAuthed(true);
    } else {
      alert("Incorrect password");
    }
  };

  const handleGeocode = async () => {
    if (!address) {
      alert("Please enter an address first");
      return;
    }

    try {
      const encodedAddress = encodeURIComponent(address);
      const apiKey = process.env.REACT_APP_GOOGLE_GEOCODE_KEY;
      const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodedAddress}&key=${apiKey}`;

      const response = await fetch(url);
      const data = await response.json();

      if (data.status === "OK") {
        const location = data.results[0].geometry.location;
        setLat(location.lat);
        setLng(location.lng);
      } else {
        alert("Geocoding failed. Status: " + data.status);
      }
    } catch (error) {
      console.error("Geocoding error:", error);
      alert("Error fetching coordinates");
    }
  };

  const handleSave = async () => {
    if (!name || !style || !price || !lat || !lng || !rating) {
      alert("Please fill in all required fields.");
      return;
    }

    const latNum = parseFloat(lat);
    const lngNum = parseFloat(lng);
    const ratingNum = parseInt(rating);

    const { data, error } = await supabase
      .from("pizzaPlaces")
      .insert([
        {
          name,
          style,
          price,
          address,
          lat: latNum,
          lng: lngNum,
          review,
          rating: ratingNum,
        },
      ]);

    if (error) {
      console.error(error);
      alert("Error saving data");
    } else {
      alert("Pizza place added successfully!");
      setName("");
      setStyle("");
      setPrice("$");
      setAddress("");
      setLat("");
      setLng("");
      setReview("");
      setRating("");
    }
  };

  if (!authed) {
    return (
      <div className="admin-form-container">
        <h2>Admin Login</h2>
        <input
          type="password"
          placeholder="Enter password"
          value={passwordInput}
          onChange={(e) => setPasswordInput(e.target.value)}
        />
        <button onClick={handlePasswordSubmit}>Login</button>
      </div>
    );
  }

  return (
    <div className="admin-form">
      <h2>Add a New Pizza Place</h2>

      <label>
        Name:
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </label>

      <label>
        Style:
        <input value={style} onChange={(e) => setStyle(e.target.value)} />
      </label>

      <label>
        Price:
        <select value={price} onChange={(e) => setPrice(e.target.value)}>
          <option>$</option>
          <option>$$</option>
          <option>$$$</option>
        </select>
      </label>

      <label>
        Address:
        <input value={address} onChange={(e) => setAddress(e.target.value)} />
      </label>
      <button onClick={handleGeocode}>Get Coordinates</button>

      <label>
        Lat:
        <input value={lat} onChange={(e) => setLat(e.target.value)} />
      </label>

      <label>
        Lng:
        <input value={lng} onChange={(e) => setLng(e.target.value)} />
      </label>

      <label>
        Review:
        <textarea value={review} onChange={(e) => setReview(e.target.value)} />
      </label>

      <label>
        Rating:
        <input value={rating} onChange={(e) => setRating(e.target.value)} />
      </label>

      <button onClick={handleSave}>Save to Database</button>
    </div>
  );
};

export default AdminForm;