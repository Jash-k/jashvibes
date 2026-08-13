import mongoose from 'mongoose';

const LiveProfileSchema = new mongoose.Schema({
  profileId: { type: String, required: true, unique: true, index: true },
  name: { type: String, required: true },
  isDefault: { type: Boolean, default: false, index: true },
  order: { type: Number, default: 0 },
}, { timestamps: true });

export default mongoose.models.LiveProfile || mongoose.model('LiveProfile', LiveProfileSchema);
