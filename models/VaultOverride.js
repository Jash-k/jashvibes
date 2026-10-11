import mongoose from 'mongoose';
const schema = new mongoose.Schema({
  id: {type:String,required:true,unique:true,index:true},
  revision: {type:Number,required:true,default:1},
  patch: {type:mongoose.Schema.Types.Mixed,default:{}},
  custom: {type:mongoose.Schema.Types.Mixed,default:null},
  hidden: {type:Boolean,default:false},
  note: {type:String,default:''},
}, {timestamps:true, minimize:false});
export default mongoose.models.VaultOverride || mongoose.model('VaultOverride',schema);
