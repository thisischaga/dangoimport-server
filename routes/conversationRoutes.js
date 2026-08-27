const express = require('express');
const router = express.Router();
const verifyToken = require('../Middlewares/verifyTokens');
const Conversation = require('../Models/Conversation');
const Message = require('../Models/Message');
const User = require('../Models/User');
const Product = require('../Models/Product');
const { getIO } = require('../utils/socket');

router.use(verifyToken);

router.get('/my', async (req, res) => {
  try {
    const userId = req.user.userId;

    const conversations = await Conversation.find({
      $or: [{ buyerId: userId }, { sellerId: userId }],
    }).sort({ updatedAt: -1 }).lean();

    const populated = await Promise.all(conversations.map(async (conversation) => {
      const buyer = await User.findById(conversation.buyerId).select('userFirstname userSurname profileImage vendorName');
      const seller = await User.findById(conversation.sellerId).select('userFirstname userSurname profileImage vendorName');
      const product = await Product.findById(conversation.productId).select('name image');
      const lastMessage = await Message.findOne({ conversationId: conversation._id }).sort({ createdAt: -1 }).lean();

      return {
        ...conversation,
        buyer,
        seller,
        product,
        lastMessage,
      };
    }));

    return res.status(200).json({ success: true, data: populated });
  } catch (error) {
    console.error('[conversationRoutes] list error:', error);
    return res.status(500).json({ message: 'Erreur récupération conversations' });
  }
});

router.post('/start', async (req, res) => {
  try {
    const { sellerId, productId } = req.body;
    const buyerId = req.user.userId;

    if (!sellerId) {
      return res.status(400).json({ message: 'Vendeur requis' });
    }

    let conversation = await Conversation.findOne({
      buyerId,
      sellerId,
      productId: productId || null,
    });

    if (!conversation) {
      conversation = await Conversation.create({
        buyerId,
        sellerId,
        productId: productId || null,
        lastMessage: '',
        unreadCountBuyer: 0,
        unreadCountSeller: 0,
      });
    }

    return res.status(200).json({ success: true, data: conversation });
  } catch (error) {
    console.error('[conversationRoutes] start error:', error);
    return res.status(500).json({ message: 'Erreur création conversation' });
  }
});

router.get('/:conversationId/messages', async (req, res) => {
  try {
    const conversation = await Conversation.findById(req.params.conversationId);
    if (!conversation) {
      return res.status(404).json({ message: 'Conversation introuvable' });
    }

    const isParticipant = conversation.buyerId.toString() === req.user.userId || conversation.sellerId.toString() === req.user.userId;
    if (!isParticipant) {
      return res.status(403).json({ message: 'Accès interdit' });
    }

    const messages = await Message.find({ conversationId: conversation._id }).sort({ createdAt: 1 }).lean();
    return res.status(200).json({ success: true, data: messages });
  } catch (error) {
    console.error('[conversationRoutes] get messages error:', error);
    return res.status(500).json({ message: 'Erreur historique messages' });
  }
});

router.post('/:conversationId/messages', async (req, res) => {
  try {
    const { content } = req.body;
    const conversation = await Conversation.findById(req.params.conversationId);

    if (!conversation) {
      return res.status(404).json({ message: 'Conversation introuvable' });
    }

    const senderId = req.user.userId;
    const isBuyer = conversation.buyerId.toString() === senderId;
    const recipientId = isBuyer ? conversation.sellerId : conversation.buyerId;

    if (!content || !String(content).trim()) {
      return res.status(400).json({ message: 'Message vide' });
    }

    const message = await Message.create({
      conversationId: conversation._id,
      senderId,
      recipientId,
      content: String(content).trim(),
      readAt: null,
    });

    const safeContent = String(content).trim();
    conversation.lastMessage = safeContent;
    conversation.updatedAt = new Date();

    if (isBuyer) {
      conversation.unreadCountSeller += 1;
    } else {
      conversation.unreadCountBuyer += 1;
    }

    await conversation.save();

    const io = getIO();
    io.to(`user_${conversation.buyerId}`).emit('chat:new_message', {
      conversationId: conversation._id,
      message,
    });
    io.to(`user_${conversation.sellerId}`).emit('chat:new_message', {
      conversationId: conversation._id,
      message,
    });

    return res.status(201).json({ success: true, data: message });
  } catch (error) {
    console.error('[conversationRoutes] send message error:', error);
    return res.status(500).json({ message: 'Erreur envoi message' });
  }
});

router.patch('/:conversationId/read', async (req, res) => {
  try {
    const conversation = await Conversation.findById(req.params.conversationId);
    if (!conversation) {
      return res.status(404).json({ message: 'Conversation introuvable' });
    }

    const userId = req.user.userId.toString();

    if (conversation.buyerId.toString() === userId) {
      conversation.unreadCountBuyer = 0;
    }

    if (conversation.sellerId.toString() === userId) {
      conversation.unreadCountSeller = 0;
    }

    await conversation.save();

    await Message.updateMany(
      {
        conversationId: conversation._id,
        recipientId: userId,
        readAt: null,
      },
      { $set: { readAt: new Date() } }
    );

    return res.status(200).json({ success: true, message: 'Messages marqués comme lus' });
  } catch (error) {
    console.error('[conversationRoutes] read error:', error);
    return res.status(500).json({ message: 'Erreur lecture messages' });
  }
});

module.exports = router;
